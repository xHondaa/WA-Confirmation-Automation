import axios from "axios";
import db from "../firebaseAdmin.js"; // Firestore Admin SDK (already initialized)

// Normalize phone to a consistent E.164-like format: keep leading + and digits only
function normalizePhone(raw) {
  if (!raw) return raw;
  const s = String(raw).replace(/[^\d+]/g, "");
  return s.startsWith("+") ? s : `+${s}`;
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
      console.log(`No pending confirmation found for ${normPhone}`);
      return;
    }

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

    const existingTags = (order.tags || "")
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);
    const nextTags = Array.from(new Set([...existingTags, tag])).join(", ");

    // 4) Update order with merged tags (idempotent: re-adding same tag is a no-op)
    await axios.put(
      `https://${shop}/admin/api/2024-07/orders/${order.id}.json`,
      { order: { id: Number(order.id), tags: nextTags } },
      {
        headers: { "X-Shopify-Access-Token": token },
      }
    );

    console.log(`Tagged order ${order.id} with ${tag}`);

    // 5) Mark confirmation as confirmed
    await docRef.update({
      status: "confirmed",
      confirmed_at: new Date(),
      last_update_at: new Date(),
      shopify_update: { ok: true, at: new Date(), action: "tag_added", tag },
    });
  } catch (error) {
    console.error("Error updating Shopify order tag:", error.response?.data || error.message || error);

    // Best-effort: if we claimed a doc and failed later, record error state
    try {
      // We don't know docRef here if failure occurred before claim completes; so only update when known
      // This catch block is primarily logging; state will remain processing/pending depending on failure point.
    } catch {}
  }
}
