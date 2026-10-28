import type { PermissionGraph } from '@halyn/shared';
import { z } from 'zod';

// Halyn Test's permission map (Step 15): read a Bolna graph agent and prove the voice agent cannot talk itself into
// an outcome. Every node that speaks one (working, awaiting_confirmation, protect, confirmed, refused) must be entered
// only by an event edge — an event only Halyn injects after its decision. An LLM edge into one of them is RED, shown
// with the path that reaches it. Also lists every path from the start node to the propose_action node. Pure.

export const GUARDED_NODES = ['working', 'awaiting_confirmation', 'protect', 'confirmed', 'refused'] as const;
const PROPOSE_TOOL = 'propose_action';
const MAX_PATHS = 200;

const EdgeSchema = z.looseObject({
  to_node_id: z.string().min(1).max(64),
  condition_type: z.string().optional(),
  event_name: z.string().max(64).optional(),
});
const NodeSchema = z.looseObject({
  id: z.string().min(1).max(64),
  function_call: z.unknown().optional(),
  edges: z.array(EdgeSchema).optional(),
});
const AgentSchema = z.looseObject({
  agent_config: z.looseObject({
    agent_name: z.string().min(1).max(80),
    tasks: z
      .array(
        z.looseObject({
          tools_config: z.looseObject({
            llm_agent: z.looseObject({
              llm_config: z.looseObject({
                current_node_id: z.string().max(64).nullish(),
                nodes: z.array(NodeSchema).min(1),
              }),
            }),
          }),
        }),
      )
      .min(1),
  }),
});
type GraphNode = z.infer<typeof NodeSchema>;

function callsTool(fn: unknown, tool: string): boolean {
  if (typeof fn === 'string') return fn === tool;
  if (Array.isArray(fn)) return fn.some((f) => callsTool(f, tool));
  if (fn && typeof fn === 'object' && 'name' in fn) return (fn as { name: unknown }).name === tool;
  return false;
}

/** Shortest path (by edges) from `start` to every node reachable from it. */
function shortestPaths(start: string, edges: (id: string) => string[]): Map<string, string[]> {
  const paths = new Map<string, string[]>([[start, [start]]]);
  const queue = [start];
  while (queue.length) {
    const id = queue.shift() as string;
    for (const to of edges(id))
      if (!paths.has(to)) {
        paths.set(to, [...(paths.get(id) ?? []), to]);
        queue.push(to);
      }
  }
  return paths;
}

export function permissionMap(file: string, agent: unknown): PermissionGraph {
  const parsed = AgentSchema.parse(agent);
  const llm = parsed.agent_config.tasks[0]?.tools_config.llm_agent.llm_config;
  const nodes: GraphNode[] = llm?.nodes ?? [];
  const start = llm?.current_node_id ?? nodes[0]?.id ?? 'start';
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const next = (id: string) => (byId.get(id)?.edges ?? []).map((e) => e.to_node_id);
  const propose = nodes.find((n) => callsTool(n.function_call, PROPOSE_TOOL))?.id ?? null;

  // Every simple path start → propose_action: a node is never visited twice on a path, so cycles end.
  const paths: string[][] = [];
  const walk = (id: string, path: string[]) => {
    if (paths.length >= MAX_PATHS) return;
    if (id === propose) {
      paths.push(path);
      return;
    }
    for (const to of next(id)) if (!path.includes(to)) walk(to, [...path, to]);
  };
  if (propose) walk(start, [start]);

  const reach = shortestPaths(start, next);
  const guarded = GUARDED_NODES.filter((g) => byId.has(g)).map((node) => ({
    node,
    inbound: nodes.flatMap((n) =>
      (n.edges ?? [])
        .filter((e) => e.to_node_id === node)
        .map((e) => ({
          from: n.id,
          kind: e.condition_type === 'event' ? ('event' as const) : ('llm' as const),
          event: e.condition_type === 'event' ? (e.event_name ?? null) : null,
        })),
    ),
  }));
  const violations = guarded.flatMap((g) =>
    g.inbound
      .filter((edge) => edge.kind === 'llm')
      .map((edge) => ({ from: edge.from, to: g.node, path: [...(reach.get(edge.from) ?? [edge.from]), g.node] })),
  );
  return {
    agent: parsed.agent_config.agent_name,
    file,
    status: propose && violations.length === 0 ? 'GREEN' : 'RED',
    start,
    propose_node: propose,
    paths,
    guarded,
    violations,
  };
}
