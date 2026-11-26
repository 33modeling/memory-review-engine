"""Copy small REA outputs and derive summaries into docs/rea/evidence (reads REA JSON only)."""
import json, sys, os, hashlib, collections
W, OUT = sys.argv[1], sys.argv[2]
os.makedirs(OUT, exist_ok=True)
def j(p): return json.load(open(os.path.join(W, p)))
def sha(p):
    h = hashlib.sha256(open(os.path.join(W, p), 'rb').read()).hexdigest()
    return {'file': p, 'bytes': os.path.getsize(os.path.join(W, p)), 'sha256': h}
copies = {'ref-source.summary.json': 'reference-source.summary.json', 'app-summary-view.json': 'app-analysis.summary-view.json',
          'app-modules-view.json': 'app-analysis.modules-view.json', 'selection.json': 'selection.json'}
for n in ('next-interval', 'schedule-days', 'learning-steps', 'forgetting-curve'):
    copies[f'trace-semantics-{n}-callers.json'] = f'trace-semantics-{n}-callers.json'
# 작업 폴더 절대 경로는 저장소에 남기지 않는다: ts-fsrs 소스 위치는 <ts-fsrs> 로 바꾼다
SRC = os.path.realpath(os.path.join(W, '..', 'ts-fsrs'))
def scrub(text):
    return text.replace(SRC, '<ts-fsrs>').replace(os.path.join(os.path.abspath(os.path.join(W, '..')), 'ts-fsrs'), '<ts-fsrs>')
for a, b in copies.items():
    with open(os.path.join(W, a), encoding='utf-8') as f:
        text = scrub(f.read())
    with open(os.path.join(OUT, b), 'w', encoding='utf-8') as f:
        f.write(text)

# 기능 사실: 파일별 함수 이름·줄 범위·호출 지점 수
app = j('app-evidence.json')['normalized_result']
sg = app['semantic_graph']
by = collections.defaultdict(lambda: {'functions': [], 'call_sites': 0, 'literals': []})
for n in sg['nodes']:
    path = n['identity'].get('module_path')
    if not path: continue
    p = n.get('properties') or {}
    if n['kind'] == 'function':
        rng = n['identity'].get('source_range') or {}
        by[path]['functions'].append({'name': p.get('name'), 'lines': [rng.get('start', {}).get('line'), rng.get('end', {}).get('line')]})
    elif n['kind'] == 'call-site':
        by[path]['call_sites'] += 1
    elif n['kind'] == 'literal' and isinstance(p.get('value'), (int, float, str)):
        by[path]['literals'].append(p.get('value'))
for v in by.values():
    v['functions'].sort(key=lambda f: f['lines'][0] or 0)
facts = {'note': 'REA analyze-javascript-application 의미 그래프에서 파일별로 모은 것. 함수 이름이 없는 것은 익명 화살표 함수',
         'statistics': app['statistics'],
         'semantic_graph': {'nodes': len(sg['nodes']), 'relations': len(sg['relations']), 'fingerprints': len(sg['fingerprints']), 'unknowns': len(sg['unknowns']),
                            'node_kinds': dict(collections.Counter(n['kind'] for n in sg['nodes']).most_common()),
                            'unknown_reasons': dict(collections.Counter(u.get('reason', '?') for u in sg['unknowns']).most_common())},
         'files': dict(sorted(by.items()))}
json.dump(facts, open(os.path.join(OUT, 'feature-facts.json'), 'w'), ensure_ascii=False, indent=1)

# 기능 추적 요약: 시드와 바로 붙은 간선만
t = j('trace-feature-algorithm.json')['normalized_result']
g = t['graph']
seeds = set(g['root_node_ids'])
label = {n['node_id']: (n['kind'], (n.get('observations') or [{}])[0].get('label')) for n in g['nodes']}
near = [{'kind': e.get('relation'), 'from': label.get(e['source_node_id'], ('?', None)), 'to': label.get(e['target_node_id'], ('?', None))}
        for e in g['edges'] if (e['source_node_id']) in seeds or (e['target_node_id']) in seeds]
json.dump({'seed': t.get('seed'), 'seed_matches': len(t.get('seed_matches', [])), 'nodes': len(g['nodes']), 'edges': len(g['edges']),
           'node_kinds': dict(collections.Counter(n['kind'] for n in g['nodes']).most_common()),
           'edge_kinds': dict(collections.Counter(e.get('relation') for e in g['edges']).most_common()),
           'seed_adjacent_edges': near}, open(os.path.join(OUT, 'trace-feature-algorithm.summary.json'), 'w'), ensure_ascii=False, indent=1)

ref = j('ref-source.json')
json.dump({'tool': 'rea-agents 6.8.0 (npx, 전역 설치·MCP 설정 없음)', 'node': os.popen('node --version').read().strip(),
           'target': {'repo': 'https://github.com/open-spaced-repetition/ts-fsrs', 'commit': 'c64b9617e61a9603737c1b97c6355ba2c3f6af16', 'license': 'MIT',
                      'checkout': 'git clone --depth 1 (실행·pnpm install 하지 않음), 분석은 packages/fsrs 만'},
           'reference_source': {'entries': len(ref['entries']), 'relationships': dict(collections.Counter(r['resolution'] for r in ref['relationships']))},
           'outputs': [sha(p) for p in ['ref-source.json', 'ref-source.summary.json', 'app-evidence.json', 'app-summary-view.json', 'app-modules-view.json',
                                        'trace-feature-algorithm.json'] + [f'trace-semantics-{n}-callers.json' for n in ('next-interval', 'schedule-days', 'learning-steps', 'forgetting-curve')]],
           'note': '큰 결과(ref-source.json, app-evidence.json, trace-feature-algorithm.json)는 저장소에 넣지 않고 크기·SHA-256 만 기록. scripts/run-rea.sh 로 다시 만든다'},
          open(os.path.join(OUT, 'rea-runs.json'), 'w'), ensure_ascii=False, indent=1)
print('ok', sorted(os.listdir(OUT)))
