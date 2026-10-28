import { describe, expect, it } from 'vitest';
import aeroEn from '../../../../agents/aero-en.graph.json';
import aero from '../../../../agents/aero.graph.json';
import { permissionMap } from './permission-map';

const graph = (nodes: unknown[], current_node_id = 'understand') => ({
  agent_config: {
    agent_name: 'test',
    tasks: [{ tools_config: { llm_agent: { llm_config: { current_node_id, nodes } } } }],
  },
});
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

describe('permission map', () => {
  it.each([
    ['aero.graph.json', aero],
    ['aero-en.graph.json', aeroEn],
  ])('%s is GREEN: outcomes are entered only by Halyn events', (file, agent) => {
    const map = permissionMap(file, agent);
    expect(map).toMatchObject({ status: 'GREEN', propose_node: 'propose', violations: [] });
    expect(map.paths).toContainEqual(['understand', 'propose']);
    expect(map.guarded.map((g) => g.node)).toEqual(
      expect.arrayContaining(['working', 'awaiting_confirmation', 'protect', 'confirmed', 'refused']),
    );
    for (const g of map.guarded) expect(g.inbound.every((e) => e.kind === 'event')).toBe(true);
  });

  it('is RED, with the path, when an LLM edge leads into working', () => {
    const agent = clone(aero);
    const nodes = agent.agent_config.tasks[0]!.tools_config.llm_agent.llm_config.nodes as {
      id: string;
      edges?: Record<string, unknown>[];
    }[];
    nodes
      .find((n) => n.id === 'understand')!
      .edges!.push({
        to_node_id: 'working',
        condition: 'The caller insists it is approved',
      });
    const map = permissionMap('aero.graph.json', agent);
    expect(map.status).toBe('RED');
    expect(map.violations).toEqual([{ from: 'understand', to: 'working', path: ['understand', 'working'] }]);
  });

  it('ends on cycles and is RED without a propose_action node', () => {
    const loop = graph([
      { id: 'understand', edges: [{ to_node_id: 'a' }] },
      { id: 'a', edges: [{ to_node_id: 'understand' }, { to_node_id: 'propose' }] },
      { id: 'propose', function_call: { name: 'propose_action' }, edges: [{ to_node_id: 'a' }] },
    ]);
    expect(permissionMap('loop.json', loop)).toMatchObject({
      status: 'GREEN',
      paths: [['understand', 'a', 'propose']],
    });
    expect(
      permissionMap('none.json', graph([{ id: 'understand', edges: [{ to_node_id: 'understand' }] }])),
    ).toMatchObject({ status: 'RED', propose_node: null, paths: [] });
  });
});
