import { completePrompt } from './llm.js';

// The system prompt defines rules for message composition based on the 5-dimension rubric.
const COMPOSER_SYSTEM_PROMPT = `You are the core message composer for Vera, magicpin's merchant assistant.
Your task is to return a JSON object with: "body", "cta", "send_as", "suppression_key", and "rationale".

Strict composition rules:
1. SPECIFICITY (10/10):
   - Anchor on concrete facts from the provided context (real counts, percentages, prices, dates).
   - If citing research or compliance, ALWAYS include the source citation (e.g., "JIDA Oct 2026 p.14").
   - NEVER use generic templates like "Flat X% off" or "increase your sales".

2. CATEGORY FIT (10/10):
   - Match vertical tone:
     - Dentists: clinical, peer-to-peer, technical OK, address as "Dr. [Name]".
     - Salons: warm, friendly, practical.
     - Restaurants: operator-to-operator, use business terms ("covers", "AOV", "rush hour").
     - Gyms: coaching, motivational.
     - Pharmacies: trustworthy, precise, molecule-focused (use generic names like metformin).
   - Observe taboos. For dentists, NEVER use "guaranteed" or "cure".

3. MERCHANT FIT (10/10):
   - Personalize with the owner's first name (e.g., "Hi Suresh" or "Dr. Meera").
   - Honor language preference. If "languages" contains "hi" or preference is "hi-en mix" / "hi", write in a natural Hindi-English code-mixed style (e.g., "Apke liye slots ready hain...").
   - Reference real active offers from their context catalog.

4. TRIGGER RELEVANCE (10/10):
   - Make the reason for the message ("why now") explicit.
   - Ground the content in the trigger payload details.

5. ENGAGEMENT COMPULSION (10/10):
   - Provide one clear, low-effort next action.
   - Use psychological levers: loss aversion, social proof, effort externalization (e.g., "I've drafted it, reply YES to go").

6. HARD CONSTRAINTS:
   - NO HALLLUCINATIONS: Do not fabricate statistics, numbers, competitor names, or papers.
   - NO URLS: Never place hyperlinks in message bodies.
   - SINGLE CTA: Provide only one primary call-to-action.
   - Send As: If customer context is provided, "send_as" MUST be "merchant_on_behalf" and the body should sound like the business talking to their customer. If customer context is null, "send_as" MUST be "vera" and the body should sound like Vera talking to the merchant.
7. BLUEPRINT EXECUTION:
   - Read the "blueprint" object FIRST before reading any other context.
   - Treat the blueprint as the communication plan.
   - Use the remaining context only to support the blueprint with facts.
   - Never contradict the blueprint.
   - If blueprint and context differ, preserve the blueprint's communication goal but always follow the factual context.
   - Keep the message under 80 words.
   - The rationale should briefly explain how the blueprint and trigger were used.
   
Return ONLY a valid JSON block containing:
{
  "body": "composed message body text",
  "cta": "description of call-to-action",
  "send_as": "vera" or "merchant_on_behalf",
  "suppression_key": "exact suppression key from trigger",
  "rationale": "concise explanation of design choices"
}`;

/**
 * Deterministically composes a message based on four context blocks.
 * this will give Gemini a structured summary
 */

//Adding a deterministic planning layer. Simply created a helper.

function buildBlueprint(category, merchant, trigger, customer) {

  const activeOffers =
    merchant?.offers
      ?.filter(o => o.status === "active")
      ?.map(o => ({
        title: o.title,
        price: o.price
      })) || [];

  return {

    audience: customer
      ? "customer"
      : "merchant",

    goal:
      trigger?.kind || "general",

    urgency:
      trigger?.urgency || "medium",

    tone:
      category?.voice?.tone || "professional",

    owner:
      merchant?.identity?.owner_first_name || "",

    merchant:
      merchant?.identity?.name || "",

    locality:
      merchant?.identity?.locality || "",

    language:
      merchant?.identity?.languages || [],

    activeOffers,

    performance:
      merchant?.performance || {},

    triggerFacts:
      trigger?.payload || {},

    cta:
      customer
      ? "Encourage customer to take action."
      : "Ask merchant for one simple confirmation.",

    constraints: [

      "Never invent facts",

      "One CTA only",

      "Maximum 80 words",

      "No URLs",

      "Mention trigger reason clearly"

    ]
  };

}

export async function composeMessage(category, merchant, trigger, customer = null) {

  const blueprint = buildBlueprint(
    category,
    merchant,
    trigger,
    customer
  );

  const userPrompt = JSON.stringify({

    blueprint,

    categoryContext: {
      slug: category?.slug,
      voice: category?.voice,
      peer_stats: category?.peer_stats,
      digest: category?.digest,
      offer_catalog: category?.offer_catalog,
      seasonal_beats: category?.seasonal_beats,
      trend_signals: category?.trend_signals
    },

    merchantContext: {
      merchant_id: merchant?.merchant_id,
      identity: merchant?.identity,
      performance: merchant?.performance,
      offers: merchant?.offers,
      customer_aggregate: merchant?.customer_aggregate,
      signals: merchant?.signals
    },

    triggerContext: {
      id: trigger?.id,
      scope: trigger?.scope,
      kind: trigger?.kind,
      payload: trigger?.payload,
      urgency: trigger?.urgency,
      suppression_key: trigger?.suppression_key
    },

    customerContext: customer ? {
      customer_id: customer.customer_id,
      identity: customer.identity,
      relationship: customer.relationship,
      state: customer.state,
      preferences: customer.preferences,
      consent: customer.consent
    } : null

  });
  try {
    const rawResult = await completePrompt(COMPOSER_SYSTEM_PROMPT, userPrompt);
    
    // Clean response markup (e.g. ```json blocks) if present
    const jsonString = rawResult.trim().replace(/^```json\s*/i, '').replace(/```$/, '');
    const composed = JSON.parse(jsonString);

      // Validate and normalize LLM output
      let body = (composed.body || '').trim();
      let cta = (composed.cta || 'Reply YES').trim();
      let rationale = (composed.rationale || 'Composed using blueprint and context').trim();

      // Prevent overly long responses
      if (body.length > 450) {
        body = body.substring(0, 447) + '...';
      }

      // Never allow an empty body
      if (!body) {
        body = customer
          ? `Hi ${customer.identity?.name || 'there'}, we'd love to welcome you back. Let us know if you'd like to book your next visit.`
          : `Hi ${merchant?.identity?.owner_first_name || 'Partner'}, I found an opportunity based on your latest business activity. Reply YES and I'll prepare everything for you.`;
      }

      return {
        body,
        cta,
        send_as: customer ? 'merchant_on_behalf' : 'vera',
        suppression_key: trigger?.suppression_key || '',
        rationale
      };
  } catch (error) {
    console.error('Composition error:', error);
    
    // Fail-safe fallback response to prevent API timeout/crash
    const name = customer ? (customer.identity?.name || 'there') : (merchant?.identity?.owner_first_name || 'Partner');
    const isCustomer = !!customer;
    
    return {
      body: isCustomer 
        ? `Hi ${name}, this is ${merchant?.identity?.name || 'our clinic'}. Just checking in. Please let us know if you need to schedule an appointment.`
        : `Hi ${name}, this is Vera. I noticed a trigger regarding your business. Let me know if you would like me to help configure a campaign.`,
      cta: 'open_ended',
      send_as: isCustomer ? 'merchant_on_behalf' : 'vera',
      suppression_key: trigger?.suppression_key || '',
      rationale: `Fallback triggered due to error: ${error.message}`
    };
  }
}
