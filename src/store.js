/**
 * In-memory storage for contexts and conversations.
 * Handles idempotency and version control for incoming metadata.
 */
class ContextStore {
  constructor() {
    // Stores contexts in a map: `scope:id` -> { version, payload, updatedAt }
    this.contexts = new Map();
    // Stores conversation states by conversationId
    this.conversations = new Map();
  }

  // Get counts of loaded contexts by scope (for health check)
  getContextCounts() {
    const counts = { category: 0, merchant: 0, customer: 0, trigger: 0 };
    for (const key of this.contexts.keys()) {
      const scope = key.split(':')[0];
      if (counts[scope] !== undefined) {
        counts[scope]++;
      }
    }
    return counts;
  }

  // Retrieve a specific context by scope and ID
  getContext(scope, contextId) {
    const entry = this.contexts.get(`${scope}:${contextId}`);
    return entry ? entry.payload : null;
  }

  // Put context with version checks (returns { accepted: boolean, currentVersion?: number })
  setContext(scope, contextId, version, payload) {
    const key = `${scope}:${contextId}`;
    const existing = this.contexts.get(key);

    if (existing && existing.version >= version) {
      return {
        accepted: false,
        reason: 'stale_version',
        currentVersion: existing.version
      };
    }

    this.contexts.set(key, {
      version,
      payload,
      updatedAt: new Date().toISOString()
    });

    return { accepted: true };
  }

  // Clear all stored contexts (teardown)
  clear() {
    this.contexts.clear();
    this.conversations.clear();
  }

  // Create or retrieve conversation state
  getConversation(conversationId) {
    return this.conversations.get(conversationId) || null;
  }

  // Initialize a new conversation session
  createConversation(conversationId, merchantId, customerId, triggerId, sendAs) {
    const session = {
      conversationId,
      merchantId,
      customerId: customerId || null,
      triggerId,
      sendAs,
      state: 'active', // 'active' | 'waiting' | 'ended'
      waitSeconds: 0,
      updatedAt: new Date().toISOString(),
      messages: [],
      autoReplyCount: 0,
      lastMessageContent: null
    };
    this.conversations.set(conversationId, session);
    return session;
  }

  // Append a message to the conversation history
  addMessage(conversationId, fromRole, body) {
    let session = this.getConversation(conversationId);
    if (!session) {
      // Return a basic fallback if session doesn't exist yet
      session = this.createConversation(conversationId, null, null, null, 'vera');
    }

    session.messages.push({
      role: fromRole, // 'vera' | 'merchant_on_behalf' | 'merchant' | 'customer'
      body,
      timestamp: new Date().toISOString()
    });
    session.updatedAt = new Date().toISOString();
    return session;
  }

  // Retrieve all conversations (for dashboard display)
  getAllConversations() {
    return Array.from(this.conversations.values());
  }
}

// Singleton store instance
const store = new ContextStore();
export default store;
