import express from 'express';
import config from './config.js';
import store from './store.js';
import { composeMessage } from './services/composer.js';
import { handleReply } from './services/replier.js';

const app = express();
app.use(express.json({ limit: '10mb' }));
app.use(express.static('public'));

const startTime = Date.now();

// Logs generated during runtime for dashboard display
const systemLogs = [];
function addLog(type, message, details = null) {
  systemLogs.push({
    timestamp: new Date().toISOString(),
    type, // 'info' | 'context' | 'tick' | 'reply' | 'error'
    message,
    details
  });
  if (systemLogs.length > 200) {
    systemLogs.shift();
  }
}

// 1. GET /v1/healthz
app.get('/v1/healthz', (req, res) => {
  const uptime = Math.floor((Date.now() - startTime) / 1000);
  const counts = store.getContextCounts();
  res.json({
    status: 'ok',
    uptime_seconds: uptime,
    contexts_loaded: counts
  });
});

// 2. GET /v1/metadata
app.get('/v1/metadata', (req, res) => {
  res.json({
    team_name: 'Vandana AI',
    team_members: ['Vandana Sheoran'],
    model: config.llmProvider === 'gemini' ? config.gemini.model : config.openai.model,
    approach: 'Modular message composer & reply dispatcher with strict context mapping',
    contact_email: 'bibliophile2706@gmail.com',
    version: '1.1.0',
    submitted_at: new Date().toISOString()
  });
});

// 3. POST /v1/context
app.post('/v1/context', (req, res) => {
  const { scope, context_id, version, payload } = req.body;

  if (!scope || !context_id || version === undefined || !payload) {
    addLog('error', 'Malformed context push received', req.body);
    return res.status(400).json({ accepted: false, reason: 'malformed_payload' });
  }

  const result = store.setContext(scope, context_id, version, payload);

  if (!result.accepted) {
    return res.status(409).json({
      accepted: false,
      reason: result.reason,
      current_version: result.currentVersion
    });
  }

  addLog('context', `Registered ${scope} "${context_id}" (v${version})`);

  res.json({
    accepted: true,
    ack_id: `ack_${context_id}_v${version}`,
    stored_at: new Date().toISOString()
  });
});

// 4. POST /v1/tick
app.post('/v1/tick', async (req, res) => {
  const { now, available_triggers } = req.body;
  const actions = [];

  addLog('tick', `Tick received at ${now}`, { available_triggers });

  if (!available_triggers || !Array.isArray(available_triggers)) {
    return res.json({ actions: [] });
  }

  for (const triggerId of available_triggers) {
    const trigger = store.getContext('trigger', triggerId);
    if (!trigger) {
      console.warn(`Trigger not found in store: ${triggerId}`);
      continue;
    }

    const merchantId = trigger.merchant_id;
    const merchant = store.getContext('merchant', merchantId);
    if (!merchant) {
      console.warn(`Merchant not found in store for trigger: ${merchantId}`);
      continue;
    }

    const category = store.getContext('category', merchant.category_slug);
    if (!category) {
      console.warn(`Category not found in store: ${merchant.category_slug}`);
      continue;
    }

    // Optional customer context
    let customer = null;
    if (trigger.scope === 'customer' && trigger.customer_id) {
      customer = store.getContext('customer', trigger.customer_id);
    }

    try {
      // Compose message
      const composed = await composeMessage(category, merchant, trigger, customer);
      
      const conversationId = `conv_${merchantId}_${triggerId}`;
      store.createConversation(conversationId, merchantId, customer?.customer_id, triggerId, composed.send_as);
      store.addMessage(conversationId, composed.send_as, composed.body);

      // Template parameters extracted for Kaleyra templates (Vera standard)
      const templateParams = [
        customer ? customer.identity?.name : merchant.identity?.owner_first_name || 'Partner',
        composed.body
      ];

      actions.push({
        conversation_id: conversationId,
        merchant_id: merchantId,
        customer_id: customer?.customer_id || null,
        send_as: composed.send_as,
        trigger_id: triggerId,
        template_name: customer ? 'merchant_recall_reminder_v1' : 'vera_research_digest_v1',
        template_params: templateParams,
        body: composed.body,
        cta: composed.cta,
        suppression_key: composed.suppression_key,
        rationale: composed.rationale
      });

      addLog('info', `Composed message for trigger "${triggerId}"`, {
        to: customer ? `Customer: ${customer.identity?.name}` : `Merchant: ${merchant.identity?.name}`,
        body: composed.body,
        rationale: composed.rationale
      });
    } catch (err) {
      addLog('error', `Failed composition for trigger ${triggerId}`, err.message);
      console.error(err);
    }
  }

  res.json({ actions });
});

// 5. POST /v1/reply
app.post('/v1/reply', async (req, res) => {
  const { conversation_id, merchant_id, customer_id, from_role, message, turn_number } = req.body;

  addLog('reply', `Reply received on "${conversation_id}" (Turn ${turn_number})`, {
    from: from_role,
    message
  });

  try {
    const response = await handleReply(conversation_id, merchant_id, customer_id, message, turn_number);
    
    addLog('info', `Formulated response to turn ${turn_number}`, response);
    res.json(response);
  } catch (err) {
    addLog('error', `Failed processing reply for conversation ${conversation_id}`, err.message);
    res.status(500).json({
      action: 'send',
      body: 'Apologies, we encountered an error processing that message.',
      rationale: 'Error fallback response.'
    });
  }
});

// 6. POST /v1/teardown (wipe state at end of simulator run)
app.post('/v1/teardown', (req, res) => {
  store.clear();
  addLog('info', 'Context and conversation states torn down.');
  res.json({ accepted: true });
});

// --- DASHBOARD API ENDPOINTS ---

app.get('/api/logs', (req, res) => {
  res.json(systemLogs);
});

app.get('/api/conversations', (req, res) => {
  res.json(store.getAllConversations());
});

app.get('/api/contexts', (req, res) => {
  const counts = store.getContextCounts();
  res.json({
    counts,
    categories: Array.from(store.contexts.keys())
      .filter(k => k.startsWith('category:'))
      .map(k => k.split(':')[1]),
    merchants: Array.from(store.contexts.keys())
      .filter(k => k.startsWith('merchant:'))
      .map(k => store.contexts.get(k).payload.identity.name)
  });
});

app.post('/api/manual-sandbox-tick', async (req, res) => {
  const { merchantIndex, triggerKind } = req.body;
  try {
    const merchantKeys = Array.from(store.contexts.keys()).filter(k => k.startsWith('merchant:'));
    if (merchantIndex < 0 || merchantIndex >= merchantKeys.length) {
      return res.status(400).json({ success: false, error: 'Invalid merchant selection' });
    }

    const merchantKey = merchantKeys[merchantIndex];
    const merchant = store.contexts.get(merchantKey).payload;
    const category = store.getContext('category', merchant.category_slug);

    if (!category) {
      return res.status(400).json({ success: false, error: 'Category context missing for this merchant' });
    }

    // Try to find a trigger in the store matching this merchant and trigger kind
    let trigger = Array.from(store.contexts.values())
      .map(entry => entry.payload)
      .find(t => t.kind === triggerKind && t.merchant_id === merchant.merchant_id);

    // If not found, mock one up
    if (!trigger) {
      trigger = {
        id: `trg_mock_${Date.now()}`,
        scope: triggerKind === 'recall_due' ? 'customer' : 'merchant',
        kind: triggerKind,
        merchant_id: merchant.merchant_id,
        urgency: 2,
        suppression_key: `mock:${triggerKind}:${merchant.merchant_id}`,
        payload: {
          category: merchant.category_slug,
          metric_or_topic: triggerKind
        }
      };
    }

    let customer = null;
    if (trigger.scope === 'customer') {
      // Find a customer linked to this merchant
      const customerKeys = Array.from(store.contexts.keys()).filter(k => k.startsWith('customer:'));
      const matchKey = customerKeys.find(k => store.contexts.get(k).payload.merchant_id === merchant.merchant_id);
      if (matchKey) {
        customer = store.contexts.get(matchKey).payload;
      } else {
        // Mock a customer
        customer = {
          customer_id: `c_mock_${Date.now()}`,
          merchant_id: merchant.merchant_id,
          identity: { name: 'Raj', phone_redacted: '<phone>', language_pref: 'hi-en mix' },
          relationship: { last_visit: '2026-05-12', visits_total: 4 },
          state: 'lapsed_soft',
          preferences: { preferred_slots: 'weekday_evening', channel: 'whatsapp' },
          consent: { opted_in_at: '2025-11-04', scope: ['recall_reminders'] }
        };
      }
    }

    const action = await composeMessage(category, merchant, trigger, customer);
    res.json({ success: true, action });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Start the server
app.listen(config.port, '0.0.0.0', () => {
  addLog('info', `Vera Bot Express Server listening on port ${config.port}`);
  console.log(`Server listening on port ${config.port}`);
});
