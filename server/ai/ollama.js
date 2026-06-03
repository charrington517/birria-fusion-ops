const { query } = require('../db/pool');
const { buildOverview } = require('../services/overview');

async function askOllama(prompt, context) {
  if (process.env.AI_ENABLED !== 'true') {
    return {
      simulated: true,
      text: rulesBased(prompt, context)
    };
  }

  const base = process.env.OLLAMA_BASE_URL || 'http://localhost:11434';
  const model = process.env.OLLAMA_MODEL || 'llama3.1:8b';

  const response = await fetch(`${base}/api/generate`, {
    method: 'POST',
    headers: {'Content-Type':'application/json'},
    body: JSON.stringify({
      model,
      prompt: `You are Birria Fusion's operations assistant. Be concise, practical, and food-truck focused.\n\nContext:\n${JSON.stringify(context, null, 2)}\n\nUser request:\n${prompt}`,
      stream: false
    })
  });

  if (!response.ok) throw new Error(`Ollama error: ${response.status} ${await response.text()}`);
  const data = await response.json();
  return { simulated: false, text: data.response || '' };
}

function rulesBased(prompt, context) {
  const insights = context.insights || [];
  if (!insights.length) return 'No major operational risks found. Focus on prep consistency, service speed, and inventory counts.';
  return insights.slice(0, 6).map((x, i) => `${i+1}. ${x.title} — ${x.detail} Recommended action: ${x.action}.`).join('\n');
}

async function createAiTask(prompt, context_type='general') {
  const created = await query('INSERT INTO ai_tasks (prompt, context_type, status) VALUES ($1,$2,$3) RETURNING *', [prompt, context_type, 'running']);
  try {
    const overview = await buildOverview();
    const result = await askOllama(prompt, overview);
    const saved = await query('UPDATE ai_tasks SET status=$1, result=$2, completed_at=NOW() WHERE id=$3 RETURNING *', ['done', result.text, created.rows[0].id]);
    await query('INSERT INTO activity (message) VALUES ($1)', [`AI task completed: ${prompt.slice(0,80)}`]);
    return saved.rows[0];
  } catch (err) {
    const saved = await query('UPDATE ai_tasks SET status=$1, result=$2, completed_at=NOW() WHERE id=$3 RETURNING *', ['failed', err.message, created.rows[0].id]);
    return saved.rows[0];
  }
}

module.exports = { askOllama, createAiTask };
