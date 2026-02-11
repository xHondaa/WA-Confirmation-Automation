import axios from "axios";
import db from "../firebaseAdmin.js"; // Firestore Admin SDK (already initialized)

// Normalize phone to E.164 format (Egypt country code: +20)
function normalizePhone(raw) {
  if (!raw) return raw;
  let s = String(raw).replace(/[^\d+]/g, "");
  // Remove leading + for processing
  if (s.startsWith("+")) s = s.slice(1);
  // Egyptian numbers: if starts with 0, replace with 20
  if (s.startsWith("0")) s = "20" + s.slice(1);
  // If doesn't start with country code, assume Egypt (20)
  if (!s.startsWith("20")) s = "20" + s;
  return "+" + s;
}

// Coerce Shopify order ID to numeric string (accepts gid://shopify/Order/123 or numeric)
function coerceOrderId(id) {
  if (typeof id === "number") return String(id);
  if (typeof id === "string") {
    if (id.startsWith("gid://shopify/Order/")) return id.split("/").pop();
    return id;
  }
  throw new Error("invalid_order_id");
}

// Simple function to tag a Shopify order by order ID (does NOT update Firebase status)
export async function tagShopifyOrder(orderId, tag) {
  const shop = `${process.env.SHOPIFY_STORE}.myshopify.com`;
  const token = process.env.SHOPIFY_API_KEY;
  if (!shop || !token) {
    console.error("Missing SHOPIFY_STORE or SHOPIFY_API_KEY env vars");
    return;
  }

  try {
    const numericOrderId = coerceOrderId(orderId);

    // Fetch current order tags
    const getRes = await axios.get(
      `https://${shop}/admin/api/2024-07/orders/${numericOrderId}.json?fields=id,tags`,
      { headers: { "X-Shopify-Access-Token": token } }
    );

    const order = getRes.data?.order;
    if (!order) throw new Error("shopify_order_not_found");

    const existingTags = (order.tags || "")
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);
    const nextTags = Array.from(new Set([...existingTags, tag])).join(", ");

    // Update order with merged tags
    await axios.put(
      `https://${shop}/admin/api/2024-07/orders/${order.id}.json`,
      { order: { id: Number(order.id), tags: nextTags } },
      { headers: { "X-Shopify-Access-Token": token } }
    );

    console.log(`Tagged order ${order.id} with "${tag}"`);
    return { success: true, orderId: order.id };
  } catch (error) {
    console.error("Error tagging Shopify order:", error.response?.data || error.message || error);
    return { success: false, error: error.message };
  }
}

export async function updateShopifyOrderTag(phone, tag) {
  const shop = `${process.env.SHOPIFY_STORE}.myshopify.com`;
  const token = process.env.SHOPIFY_API_KEY;
  if (!shop || !token) {
    console.error("Missing SHOPIFY_STORE or SHOPIFY_API_KEY env vars");
    return;
  }

  const normPhone = normalizePhone(phone);
  const COL = process.env.CONFIRMATIONS_COLLECTION || "confirmations"; // configurable collection name

  console.log(`🔍 Looking for pending confirmation for phone: ${normPhone}`);

  try {
    // 1) Find newest pending confirmation doc for this phone
    const q = db
      .collection(COL)
      .where("phone_e164", "==", normPhone)
      .where("status", "==", "pending")
      .orderBy("confirmation_sent_at", "desc")
      .limit(1);

    const snap = await q.get();
    if (snap.empty) {
      console.log(`❌ No pending confirmation found for ${normPhone}`);
      return;
    }

    const docData = snap.docs[0].data();
    console.log(`✅ Found pending order: ${docData.order_id} (order_number: ${docData.order_number})`);

    const docRef = snap.docs[0].ref;

    // 2) Atomically claim: pending -> processing to prevent races
    const { orderId } = await db.runTransaction(async (tx) => {
      const doc = await tx.get(docRef);
      if (!doc.exists) throw new Error("confirmation_doc_missing");
      const data = doc.data();
      if (data.status !== "pending") throw new Error("already_claimed");

      tx.update(docRef, {
        status: "processing",
        processing_started_at: new Date(),
        last_update_at: new Date(),
      });

      return { orderId: coerceOrderId(data.order_id) };
    });

    // 3) Fetch current order tags (optional but helps idempotency)
    const getRes = await axios.get(
      `https://${shop}/admin/api/2024-07/orders/${orderId}.json?fields=id,tags`,
      {
        headers: { "X-Shopify-Access-Token": token },
      }
    );

    const order = getRes.data?.order;
    if (!order) throw new Error("shopify_order_not_found");

    // Status tags to remove when updating (removes old status before adding new one)
    const tagsToRemove = [
      "⚠ Confirmation Pending",
      "✅ Order Confirmed",
      "🪦 Order Cancelled"
    ];

    const existingTags = (order.tags || "")
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);

    // Remove old status tags and add new tag
    const filteredTags = existingTags.filter(t => !tagsToRemove.includes(t));
    const nextTags = Array.from(new Set([...filteredTags, tag])).join(", ");

    console.log(`📋 Existing tags: ${existingTags.join(", ") || "(none)"}`);
    console.log(`🗑️ Removing tags: ${tagsToRemove.filter(t => existingTags.includes(t)).join(", ") || "(none)"}`);
    console.log(`➕ Adding tag: "${tag}"`);
    console.log(`📝 New tags will be: ${nextTags}`);

    // 4) Update order with merged tags (idempotent: re-adding same tag is a no-op)
    const putRes = await axios.put(
      `https://${shop}/admin/api/2024-07/orders/${order.id}.json`,
      { order: { id: Number(order.id), tags: nextTags } },
      {
        headers: { "X-Shopify-Access-Token": token },
      }
    );

    console.log(`✅ Shopify API response status: ${putRes.status}`);
    console.log(`✅ Shopify returned tags: ${putRes.data?.order?.tags || "(not returned)"}`);
    console.log(`✅ Tagged Shopify order ${order.id} with "${tag}"`);

    // 5) Update Firebase status based on the tag
    const isCancellation = tag.includes("Cancelled") || tag.includes("Cancel");
    const newStatus = isCancellation ? "cancelled" : "confirmed";
    const timestampField = isCancellation ? "cancelled_at" : "confirmed_at";

    await docRef.update({
      status: newStatus,
      [timestampField]: new Date(),
      last_update_at: new Date(),
      shopify_update: { ok: true, at: new Date(), action: "tag_added", tag },
    });

    console.log(`📝 Firebase status updated to: ${newStatus}`);
  } catch (error) {
    console.error("Error updating Shopify order tag:", error.response?.data || error.message || error);

    // Best-effort: if we claimed a doc and failed later, record error state
    try {
      // We don't know docRef here if failure occurred before claim completes; so only update when known
      // This catch block is primarily logging; state will remain processing/pending depending on failure point.
    } catch {}
  }
}
