// node scripts/bolna/inspect-agent.mjs <agents/x.current.json>… — one-screen summary of a stored agent snapshot
// (webhook with the key hidden, guardrails, voice, endpointing, DTMF, graph nodes with their edge kinds, tools).
import { readFileSync } from 'node:fs';
for (const f of process.argv.slice(2)) {
  const a = JSON.parse(readFileSync(f, 'utf8'));
  const cfg = a.agent_config ?? a;
  const task = (cfg.tasks ?? a.tasks)?.[0];
  const tc = task?.tools_config ?? {};
  const llm = tc.llm_agent?.llm_config ?? {};
  const nodes = llm.nodes ?? [];
  console.log(f, {
    webhook: String(cfg.webhook_url ?? a.webhook_url).replace(/key=[^&]+/, 'key=…'),
    guardrails: cfg.calling_guardrails ?? a.calling_guardrails,
    voice: tc.synthesizer?.provider_config?.voice_id,
    model: tc.synthesizer?.provider_config?.model,
    speed: tc.synthesizer?.provider_config?.speed,
    endpointing: tc.transcriber?.endpointing,
    dtmf: task?.task_config?.dtmf_enabled,
    agent_type: tc.llm_agent?.agent_type,
    start: llm.current_node_id,
    nodes: nodes
      .map(
        (n) =>
          `${n.id}${n.node_type === 'static' ? '(s)' : ''}[${(n.edges ?? []).map((e) => (e.event_name ? 'ev:' + e.event_name : (e.condition_type ?? 'llm'))).join(',')}]`,
      )
      .join(' '),
    tools: (tc.api_tools?.tools ?? []).map((t) => t.name).join(','),
  });
}
