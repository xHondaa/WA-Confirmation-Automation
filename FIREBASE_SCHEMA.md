# Firebase Schema Documentation

## Collections

### 1. `whatsappMessages`
Stores all WhatsApp messages (both inbound and outbound).

#### Fields:
- **customer** (string): Customer's WhatsApp ID (phone number without +)
- **message_type** (string): Type of message - "text", "template", "button", "interactive", etc.
- **text** (string, nullable): Text content for text messages
- **template_name** (string, optional): Name of the template used (for outbound templates)
- **variables** (object, optional): Variables passed to the template
- **button_title** (string, nullable): Title of button clicked (for inbound)
- **button_id** (string, nullable): ID of button clicked (for inbound)
- **raw** (object, optional): Raw message object from WhatsApp (for inbound)
- **direction** (string): **NEW** - "inbound" or "outbound"
- **order_number** (string, nullable): **NEW** - Order number linked to this message
- **message_id** (string, nullable): **NEW** - WhatsApp message ID (for tracking status)
- **status** (string): **NEW** - Message delivery status: "pending", "sent", "delivered", "read", "failed"
- **status_updated_at** (timestamp): **NEW** - When the status was last updated
- **timestamp** (string): ISO timestamp when message was created/received

### 2. `confirmations`
Stores order confirmations sent to customers.

#### Fields:
- **phone_e164** (string): Customer phone in E.164 format (e.g., +201234567890)
- **order_id** (string): Shopify order ID
- **order_number** (string): **UPDATED** - Human-readable order number
- **status** (string): Order status - "pending", "confirmed", "cancelled"
- **confirmation_sent_at** (timestamp): When the confirmation was sent
- **name** (string): Customer name
- **address** (string): Shipping address
- **price** (string): Order total price
- **direction** (string): **NEW** - Always "outbound" for confirmations
- **message_status** (string): **NEW** - WhatsApp message status: "pending", "sent", "delivered", "read", "failed"
- **message_id** (string, optional): **NEW** - WhatsApp message ID for tracking
- **status_updated_at** (timestamp): **NEW** - When the message status was last updated

### 3. `whatsappInteractions`
Stores customer interaction events (confirmations, cancellations, reschedules).

#### Fields:
- **customer** (string): Customer's WhatsApp ID
- **event** (string): Event type - "confirmed", "cancelled", "reschedule", "talk_to_human"
- **language** (string): Language used - "en" or "ar"
- **order_number** (string, nullable): Order number associated with the event
- **button** (string, optional): Button text/ID that triggered the event
- **rawMessage** (object, optional): Raw message data
- **timestamp** (string): ISO timestamp of the event

## New Features

### 1. Direction Field
Every message now includes a `direction` field:
- **"outbound"**: Messages sent from your system to customers
- **"inbound"**: Messages received from customers

This allows you to:
- Filter messages by direction
- Track conversation flows
- Analyze customer engagement

### 2. Order ID Link
Messages are now linked to orders via the `order_number` field:
- Automatically populated from the customer's latest order
- Links inbound messages to the order context
- Links outbound messages to the specific order

### 3. Status Tracking for Outbound Messages
WhatsApp provides delivery status updates for sent messages:

**Status values:**
- **"pending"**: Message queued to be sent
- **"sent"**: Message sent to WhatsApp servers
- **"delivered"**: Message delivered to customer's device
- **"read"**: Customer has read the message
- **"failed"**: Message failed to send

**Implementation:**
- Status is stored in the `status` field
- Timestamp of last update in `status_updated_at`
- Status updates are received via the `/api/whatsappStatusWebhook` endpoint

## Webhook Configuration

### WhatsApp Status Webhook
To receive status updates, configure the webhook in your WhatsApp Business API:

**Endpoint:** `https://your-domain.com/api/whatsappStatusWebhook`

**Webhook fields to subscribe:**
- `messages` (for status updates)

The webhook will automatically update message statuses in Firebase when WhatsApp sends delivery/read receipts.

## Querying Examples

### Get all outbound messages for an order:
```javascript
const messages = await db.collection('whatsappMessages')
  .where('direction', '==', 'outbound')
  .where('order_number', '==', '1234')
  .get();
```

### Get inbound messages from a customer:
```javascript
const messages = await db.collection('whatsappMessages')
  .where('direction', '==', 'inbound')
  .where('customer', '==', '201234567890')
  .orderBy('timestamp', 'desc')
  .get();
```

### Check message delivery status:
```javascript
const messages = await db.collection('whatsappMessages')
  .where('message_id', '==', 'wamid.xxx')
  .get();

const status = messages.docs[0].data().status; // 'delivered', 'read', etc.
```

### Get all failed messages:
```javascript
const failedMessages = await db.collection('whatsappMessages')
  .where('status', '==', 'failed')
  .where('direction', '==', 'outbound')
  .get();
```

## Migration Notes

If you have existing data:
1. Existing messages won't have `direction`, `order_number`, or `status` fields
2. New messages will automatically include all fields
3. You can backfill direction based on message type or customer field patterns
4. Order number can be backfilled by looking up confirmations collection
