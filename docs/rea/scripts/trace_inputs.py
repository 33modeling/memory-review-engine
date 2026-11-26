"""Write REA trace inputs from the ts-fsrs analysis (reads REA JSON only)."""
import json, sys, os
W = sys.argv[1]
os.chdir(W)
ev = json.load(open('app-evidence.json'))
sg = ev['normalized_result']['semantic_graph']
def fp(name, suffix):
    node = next(n for n in sg['nodes'] if n['kind'] in ('function', 'method') and (n.get('properties') or {}).get('name') == name
                and n['identity']['module_path'].endswith(suffix))
    return next(f['fingerprint_sha256'] for f in sg['fingerprints'] if f['function_node_id'] == node['node_id'])
json.dump({'application': ev, 'seed': {'kind': 'module', 'value': 'src/models/fsrs-6/algorithm.ts', 'match': 'exact'}, 'direction': 'both'},
          open('trace-feature-algorithm-input.json', 'w'))
semantic = {
    'next-interval-callers': ('next_interval', 'fsrs-6/algorithm.ts'),
    'schedule-days-callers': ('calculateScheduleDays', 'monotonic-interval/core.ts'),
    'learning-steps-callers': ('calculateLearningSteps', 'learning-steps/core.ts'),
    'forgetting-curve-callers': ('forgetting_curve', 'fsrs-6/algorithm.ts'),
}
for name, (fn, suffix) in semantic.items():
    try:
        seed = {'kind': 'function', 'fingerprint_sha256': fp(fn, suffix)}
    except StopIteration:
        seed = {'kind': 'property', 'name': fn}
    json.dump({'application': ev, 'query': {'seed': seed, 'direction': 'callers', 'include_ambiguous_dynamic_edges': True}},
              open(f'trace-semantics-{name}-input.json', 'w'))
print('ok')
