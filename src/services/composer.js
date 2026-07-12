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
   - The first sentence MUST immediately explain why the message is being sent.
   - Do NOT begin with "Hi", "Hello", or a greeting unless it is essential.
   - Lead with the trigger, opportunity, or important business fact.
   - Mention at least one concrete fact from the provided context.
   - End with exactly one simple CTA.

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

function analyzeMerchant(merchant) {

  const performance = merchant?.performance || {};
  const offers = merchant?.offers || [];
  const identity = merchant?.identity || {};
  const signals = merchant?.signals || [];

  const activeOffer =
    offers.find(o => o.status === "active") || null;

  let problem = "Maintain business growth";

  if (performance.ctr !== undefined && performance.ctr < 5)
    problem = "Low click-through rate";

  else if (performance.calls !== undefined && performance.calls < 20)
    problem = "Low customer enquiries";

  else if (signals.includes("traffic_drop"))
    problem = "Traffic has reduced";

  else if (signals.includes("low_repeat_rate"))
    problem = "Repeat customers are decreasing";

  let goal = "Increase customer engagement";

  if (problem.includes("click"))
    goal = "Improve listing performance";

  if (problem.includes("Traffic"))
    goal = "Recover visibility";

  if (problem.includes("Repeat"))
    goal = "Bring customers back";

  let strength = "Stable business";

  if (activeOffer)
    strength = "Active offer available";

  if ((performance.calls || 0) > 50)
    strength = "Strong customer enquiries";

  if ((performance.repeat_rate || 0) > 40)
    strength = "Strong repeat customer base";

  return {

    owner:
      identity.owner_first_name || "",

    business:
      identity.name || "",

    locality:
      identity.locality || "",

    language:
      identity.languages || [],

    problem,

    goal,

    strength,

    bestOffer:
      activeOffer
        ? `${activeOffer.title}${activeOffer.price ? ` at ₹${activeOffer.price}` : ""}`
        : "No active offer",

    activeOffer

  };

}

function analyzeTrigger(trigger, merchant) {

  const payload = trigger?.payload || {};

  let reason = "Business opportunity";
  let urgency = "Medium";
  let objective = "Increase engagement";

  switch (trigger?.kind) {

    case "research_digest":
      reason = "New market research is available";
      objective = "Act on local demand";
      break;

    case "recall_due":
      reason = "Customer is due for a follow-up";
      objective = "Bring the customer back";
      break;

    case "festival":
      reason = "Upcoming seasonal opportunity";
      objective = "Increase festive sales";
      break;

    case "performance_drop":
      reason = "Business performance has declined";
      objective = "Recover visibility";
      break;

    case "offer_expiry":
      reason = "An active offer is about to expire";
      objective = "Retain conversions";
      break;

    case "review_request":
      reason = "Customer feedback opportunity";
      objective = "Increase reviews";
      break;

    default:
      reason = trigger?.kind || "General engagement";
  }

  if ((trigger?.urgency || 0) >= 4)
    urgency = "High";
  else if ((trigger?.urgency || 0) <= 1)
    urgency = "Low";

  // Extract only meaningful facts
  const facts = [];

  Object.entries(payload).forEach(([key, value]) => {

    if (
      value !== null &&
      value !== undefined &&
      value !== "" &&
      typeof value !== "object"
    ) {
      facts.push(`${key}: ${value}`);
    }

  });

  return {

    reason,

    urgency,

    objective,

    priority: trigger?.kind,

    facts

  };

}

function generateCTA(trigger) {

  switch (trigger?.kind) {

    case "research_digest":
      return {
        cta: "Reply YES and I'll prepare the campaign.",
        intent: "campaign"
      };

    case "recall_due":
      return {
        cta: "Reply YES and I'll prepare the recall message.",
        intent: "recall"
      };

    case "festival":
      return {
        cta: "Reply YES to launch your festive campaign.",
        intent: "festival"
      };

    case "performance_drop":
      return {
        cta: "Reply YES to recover your visibility.",
        intent: "performance"
      };

    case "offer_expiry":
      return {
        cta: "Reply YES to extend your offer.",
        intent: "offer"
      };

    case "review_request":
      return {
        cta: "Reply YES and I'll draft the review request.",
        intent: "review"
      };

    default:
      return {
        cta: "Reply YES to continue.",
        intent: "general"
      };

  }

}

function getCategoryRules(category) {

  const slug = category?.slug || "";

  switch (slug) {

    case "dentists":
      return {
        greeting: "Dr.",
        tone: "Clinical, professional and peer-to-peer.",
        vocabulary: [
          "appointment",
          "check-up",
          "oral health",
          "patient"
        ],
        avoid: [
          "guaranteed",
          "cure"
        ]
      };

    case "restaurants":
      return {
        greeting: "Hi",
        tone: "Operator-to-operator. Business focused.",
        vocabulary: [
          "covers",
          "AOV",
          "rush hour",
          "repeat orders"
        ],
        avoid: [
          "viral",
          "guaranteed"
        ]
      };

    case "salons":
      return {
        greeting: "Hi",
        tone: "Warm, friendly and practical.",
        vocabulary: [
          "appointments",
          "clients",
          "styling",
          "beauty"
        ],
        avoid: [
          "cheap"
        ]
      };

    case "gyms":
      return {
        greeting: "Hi",
        tone: "Motivational and coaching focused.",
        vocabulary: [
          "members",
          "fitness",
          "consistency",
          "progress"
        ],
        avoid: [
          "miracle"
        ]
      };

    case "pharmacies":
      return {
        greeting: "Hi",
        tone: "Trustworthy, precise and informative.",
        vocabulary: [
          "medicine",
          "availability",
          "generic",
          "prescription"
        ],
        avoid: [
          "guaranteed",
          "instant cure"
        ]
      };

    default:
      return {
        greeting: "Hi",
        tone: "Professional.",
        vocabulary: [],
        avoid: []
      };

  }

}

function buildBlueprint(category, merchant, trigger, customer) {

  const merchantSummary = analyzeMerchant(merchant);

  const triggerSummary = analyzeTrigger(trigger, merchant);

  const categoryRules = getCategoryRules(category);

  const ctaPlan = generateCTA(trigger);

  return {

    audience:
      customer ? "customer" : "merchant",

    merchant: merchantSummary,

    trigger: triggerSummary,

    category: categoryRules,

    cta: ctaPlan,

    sendAs:
      customer
        ? "merchant_on_behalf"
        : "vera",

    constraints: [

      "Never invent facts",

      "Use only supplied information",

      "Maximum 60 words",

      "One CTA only",

      "The FIRST sentence must explain why this message is being sent",

      "Start with the trigger or opportunity, NOT a greeting",

      "Mention one concrete merchant fact or active offer",

      "Use category-specific tone and vocabulary",

      "End with exactly one low-effort CTA",

      "No URLs",

      "Do not use generic marketing language"

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

  merchantSummary: blueprint.merchant,

  triggerSummary: blueprint.trigger,

  categoryRules: blueprint.category,

  ctaPlan: blueprint.cta,

  customerSummary: customer
    ? {
        name: customer.identity?.name,
        language: customer.identity?.language_pref,
        relationship: customer.relationship,
        state: customer.state
      }
    : null,

  instructions: {
    objective:
      "Write ONE WhatsApp message that sounds like an experienced business growth manager helping this merchant. Do not sound like an AI assistant. Ground every sentence in the supplied blueprint.",

    successCriteria: [

      "Lead with the strongest business opportunity from the blueprint",

      "Mention at least one merchant fact from merchantSummary",

      "Mention one concrete offer or metric when available",

      "Keep between 35 and 55 words",

      "Exactly one CTA",

      "No hallucinations"

    ]
  }

});
  try {
    const rawResult = await completePrompt(COMPOSER_SYSTEM_PROMPT, userPrompt);
    
    // Clean response markup (e.g. ```json blocks) if present
    const jsonString = rawResult.trim().replace(/^```json\s*/i, '').replace(/```$/, '');
    const composed = JSON.parse(jsonString);

    // Ensure CTA is always present
    const bodyText = composed.body || "";

      if (
        !bodyText.toLowerCase().includes("reply yes") &&
        !bodyText.toLowerCase().includes("reply")
      ) {
        composed.body = `${bodyText} Reply YES to continue.`;
      }

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
          ? `Your next visit is due. ${merchant?.identity?.name || 'Our clinic'} has reserved a convenient appointment slot for you. Reply YES if you'd like us to schedule it.`
          : `A new business opportunity matches your recent business activity. Reply YES and I'll prepare a personalized campaign for you.`;
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
    ? `Your next visit is due. ${merchant?.identity?.name || 'Our clinic'} has reserved a convenient appointment slot for you. Reply YES if you'd like us to schedule it.`
    : `A new business opportunity matches your recent business activity. Reply YES and I'll prepare a personalized campaign for you.`,
  cta: isCustomer ? 'Reply YES to book' : 'Reply YES',
      send_as: isCustomer ? 'merchant_on_behalf' : 'vera',
      suppression_key: trigger?.suppression_key || '',
      rationale: `Fallback triggered due to error: ${error.message}`
    };
  }
}
