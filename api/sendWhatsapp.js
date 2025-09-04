import axios from "axios";

// Order parameters explicitly to match the template placeholders
// Include parameter_name for Meta named variables support
function getBodyParameters(templateName, variables) {
    if (templateName === "order_confirmation" || templateName === "order_confirmation_ar") {
        // Body placeholders appear in this order in your template:
        // Hello {{name}}!\nOrder: #BUT{{orderid}}\nShipping Address: {{address}}\nTotal Price: {{price}} EGP
        // Hence, the correct named parameters array in this order:
        const keys = ["name", "orderid", "address", "price"];
        return keys.map((k) => ({
            type: "text",
            parameter_name: k,
            text: variables[k] != null ? String(variables[k]) : "",
        }));
    }
if (templateName === "order_shipping_ar") {
        // Arabic shipping template uses a single {{name}} variable
        const keys = ["name"];
        return keys.map((k) => ({
            type: "text",
            parameter_name: k,
            text: variables[k] != null ? String(variables[k]) : "",
        }));
    }
    if (templateName === "order_shipping_en") {
        // English shipping template has NO variables → return no body parameters
        return [];
    }
    // Fallback: send all provided variables as named parameters in given object order
    return Object.entries(variables).map(([key, value]) => ({
        type: "text",
        parameter_name: key,
        text: value != null ? String(value) : "",
    }));
}

// Map template name to its language code (default to English)
function getLanguageForTemplate(templateName) {
    // Use the exact locale used in your template registrations
    if (/_ar$/i.test(templateName)) return "ar_EG"; // e.g., order_confirmation_ar, order_shipping_ar
    return "en";
}

// Header parameters for templates that have a named variable in the header
function getHeaderParameters(templateName, variables) {
    // Your template shows a named header variable: #BUT{{orderid}}
    if (templateName === "order_confirmation" || templateName === "order_confirmation_ar") {
        return [
            {
                type: "text",
                parameter_name: "orderid",
                text: variables.orderid != null ? String(variables.orderid) : "",
            },
        ];
    }
    return [];
}

const isBeta = () => String(process.env.BETA_TESTING || "").toLowerCase() === "true";
const getTestPhoneDigits = () => (process.env.TEST_PHONE || "").replace(/[^0-9]/g, "");

async function sendTextRaw(toDigitsVal, body) {
    if (!toDigitsVal) return;
    const url = `https://graph.facebook.com/v23.0/${process.env.WHATSAPP_PHONE_ID}/messages`;
    try {
        await axios.post(
            url,
            { messaging_product: "whatsapp", to: toDigitsVal, type: "text", text: { body } },
            { headers: { Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`, "Content-Type": "application/json" } }
        );
    } catch (e) {
        console.warn("⚠️ Failed to send beta mirror text:", e.response?.data || e.message);
    }
}

// ✅ Exported function for sending WhatsApp templates
export async function sendWhatsappTemplate(to, templateName, variables = {}) {
    const url = `https://graph.facebook.com/v23.0/${process.env.WHATSAPP_PHONE_ID}/messages`;

    const components = [];
    const headerParams = getHeaderParameters(templateName, variables);
    if (headerParams.length > 0) {
        components.push({ type: "header", parameters: headerParams });
    }
    const bodyParams = getBodyParameters(templateName, variables);
    if (bodyParams.length > 0) {
        components.push({ type: "body", parameters: bodyParams });
    }

    const toDigits = (to || '').replace(/[^0-9]/g, "");

    const tmpl = {
        name: templateName,
        language: { code: getLanguageForTemplate(templateName) },
    };
    if (components.length > 0) {
        tmpl.components = components;
    }

    const data = {
        messaging_product: "whatsapp",
        to: toDigits,
        type: "template",
        template: tmpl,
    };

    console.log("Outgoing WhatsApp Payload:", JSON.stringify(data, null, 2));

    const response = await axios.post(url, data, {
        headers: {
            Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`,
            "Content-Type": "application/json",
        },
    });

    // BETA: mirror outgoing to tester
    try {
        if (isBeta()) {
            const tester = getTestPhoneDigits();
            if (tester && tester !== toDigits) {
                const summaryLines = [
                    "[BETA OUTGOING COPY]",
                    `To: +${toDigits}`,
                    variables?.name ? `Name: ${variables.name}` : null,
                    (variables?.orderid || variables?.order_number) ? `Order: ${variables.orderid || variables.order_number}` : null,
                    `Template: ${templateName}`,
                    `Lang: ${getLanguageForTemplate(templateName)}`
                ].filter(Boolean);
                await sendTextRaw(tester, summaryLines.join("\n"));
                const mirrorData = { ...data, to: tester };
                await axios.post(url, mirrorData, {
                    headers: {
                        Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`,
                        "Content-Type": "application/json",
                    },
                });
            }
        }
    } catch (e) {
        console.warn("⚠️ Failed to mirror outgoing to tester:", e.response?.data || e.message);
    }

    return response.data;
}

// ✅ Default API handler (keeps Vercel happy)
export default async function handler(req, res) {
    if (req.method !== "POST") {
        return res.status(405).json({ error: "Method not allowed" });
    }

    try {
        const { to, templateName, variables = {} } = req.body;

        if (!to || !templateName) {
            return res
                .status(400)
                .json({ error: "Missing required fields: 'to' or 'templateName'" });
        }

        const result = await sendWhatsappTemplate(to, templateName, variables);

        return res.status(200).json({
            success: true,
            messageId: result.messages?.[0]?.id,
            sentTo: to,
            templateUsed: templateName,
            variablesSent: variables,
        });
    } catch (error) {
        console.error("Error sending WhatsApp:", error.response?.data || error.message);
        return res
            .status(500)
            .json({ error: "Failed to send WhatsApp message", details: error.response?.data || error.message });
    }
}
