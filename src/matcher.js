/**
 * Uses Groq API to score a job post against the user's skills.
 * Returns: { score: number, reasoning: string, action: string }
 */

// Rate limit delay (ms) — free tier is 6000 TPM, ~10 requests/min safe
const RATE_LIMIT_DELAY = 2000;

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

export async function matchJob(post, skills) {
  const skillsList = skills.join(', ');
  const postText = `Title: ${post.title}\nContent: ${post.content.substring(0, 500)}`;

  const systemPrompt = `You are a job matching assistant for a Social Media Manager (SMM) professional looking for CLIENTS.

CRITICAL DISTINCTION:
- CLIENT POST = Someone HIRING a social media manager (GOOD — score high)
- SERVICE POST = A VA/freelancer OFFERING their services (BAD — score 0)

SIGNS OF A CLIENT POST (someone looking to hire):
- "Looking for", "Hiring", "Need a", "Seeking", "We're looking for"
- "DM me if you can", "Contact me if interested"
- Mentions budget, payment, rate, salary
- Asks for portfolio, samples, rates
- "Anyone who can...", "Who knows someone who can..."

SIGNS OF A SERVICE POST (someone offering services — SKIP):
- "I'm a VA", "I offer", "I can do", "My services include"
- "DM me for rates", "Hire me", "Available for work"
- Lists their own skills/experience
- "Looking for clients", "Open for hire"
- Service provider marketing their own work

SKILLS:
${skillsList}

SCORING RULES:
- Score 0-100 ONLY for CLIENT posts (someone hiring)
- 80-100: Strong match — clearly hiring for SMM/VA work, mentions budget/tasks
- 60-79: Good match — likely hiring, mentions social media needs
- 40-59: Partial match — might be hiring, unclear intent
- 0-39: Weak match or unclear

ALWAYS SCORE 0 (EXCLUDE):
- Anyone OFFERING services (VAs, freelancers advertising themselves)
- "I'm available for hire", "DM for rates", "My services include"
- Software developer only roles
- Physical/on-site only positions
- Spam, MLM, or recruitment scams
- Job postings not related to SMM/VA/content work
- Posts asking "who knows someone" (referral, not direct hire)

RESPOND WITH ONLY valid JSON:
{"score": <number>, "reasoning": "<brief explanation>", "action": "apply"|"skip"|"maybe"}`;

  // Retry logic for rate limits
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${process.env.GROQ_API_KEY}`,
        },
        body: JSON.stringify({
          model: 'llama-3.1-8b-instant',
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: postText },
          ],
          temperature: 0.3,
          max_tokens: 200,
        }),
      });

      const data = await res.json();

      // Rate limited — wait and retry
      if (!res.ok && data.error?.code === 'rate_limit_exceeded') {
        const waitTime = (attempt + 1) * 5000; // 5s, 10s, 15s
        console.log(`  ⏳ Rate limited, waiting ${waitTime / 1000}s (attempt ${attempt + 1}/3)...`);
        await sleep(waitTime);
        continue;
      }

      if (!res.ok) {
        console.error(`  ❌ Groq API error: ${JSON.stringify(data)}`);
        return { score: 0, reasoning: 'API error', action: 'skip' };
      }

      const reply = data.choices?.[0]?.message?.content?.trim() || '';
      // Parse JSON from response (handle markdown code blocks)
      const jsonStr = reply.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      const result = JSON.parse(jsonStr);

      // Add delay between successful calls to avoid rate limiting
      await sleep(RATE_LIMIT_DELAY);

      return {
        score: Math.min(100, Math.max(0, result.score || 0)),
        reasoning: result.reasoning || 'No reasoning provided',
        action: result.action || 'skip',
      };
    } catch (err) {
      console.error(`  ❌ Matcher error: ${err.message}`);
      return { score: 0, reasoning: 'Matching failed', action: 'skip' };
    }
  }

  return { score: 0, reasoning: 'Rate limit exceeded', action: 'skip' };
}
