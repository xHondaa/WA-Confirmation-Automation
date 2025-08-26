import axios from "axios";

export async function updateShopifyOrderTag(phone, tag) {
  try {
    // Lookup order by customer phone
    const orders = await axios.get(
      `https://${process.env.SHOPIFY_STORE}.myshopify.com/admin/api/2024-07/orders.json?phone=${phone}`,
      {
        headers: {
          "X-Shopify-Access-Token": process.env.SHOPIFY_API_KEY
        }
      }
    );

    if (!orders.data.orders.length) return;

    const order = orders.data.orders[0];
    const newTags = [...order.tags.split(",").map(t => t.trim()), tag];

    await axios.put(
      `https://${process.env.SHOPIFY_STORE}.myshopify.com/admin/api/2024-07/orders/${order.id}.json`,
      { order: { id: order.id, tags: newTags.join(", ") } },
      {
        headers: {
          "X-Shopify-Access-Token": process.env.SHOPIFY_API_KEY
        }
      }
    );

    console.log(`Tagged order ${order.id} with ${tag}`);
  } catch (error) {
    console.error("Error updating Shopify order tag:", error.response?.data || error);
  }
}
