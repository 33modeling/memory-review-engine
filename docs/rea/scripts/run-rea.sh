#!/usr/bin/env bash
# ts-fsrs(open-spaced-repetition/ts-fsrs, MIT)의 FSRS 스케줄러 소스를 REA(rea-agents 6.8.0)로 정적 분석해 docs/rea/evidence/ 결과를 다시 만드는 절차.
# ts-fsrs 코드는 내려받아 읽기만 한다(npm/pnpm install·빌드·실행 없음).
# 사용법: bash docs/rea/scripts/run-rea.sh <작업 폴더>   (Node 22, git, python3 필요)
set -euo pipefail
WORK=$(cd "${1:?작업 폴더를 지정하세요}" && pwd)
HERE=$(cd "$(dirname "$0")" && pwd)
REA="nice -n 10 npx -y rea-agents@6.8.0"
COMMIT=c64b9617e61a9603737c1b97c6355ba2c3f6af16   # 분석 시점 main (2026-11-25)
mkdir -p "$WORK/work"
cd "$WORK"

# 1. ts-fsrs 소스만 얕게 받기
if [ ! -d ts-fsrs ]; then
  git init -q ts-fsrs
  git -C ts-fsrs remote add origin https://github.com/open-spaced-repetition/ts-fsrs.git
  git -C ts-fsrs fetch -q --depth 1 origin "$COMMIT"
  git -C ts-fsrs checkout -q FETCH_HEAD
fi
SRC="$WORK/ts-fsrs/packages/fsrs"
cd "$WORK/work"

# 2. fsrs 패키지 전체의 모듈 관계(HistoricalSourceGraph)와 요약
$REA import-reference-source "$SRC" --format json > ref-source.json
$REA import-reference-source "$SRC" --detail summary --outline-depth 3 --format json > ref-source.summary.json

# 3. 스케줄링에 쓰이는 파일만 정적 분석
python3 -I - <<'PY'
import json
paths = ["src/models/fsrs-6/algorithm.ts", "src/models/fsrs-6/constants.ts", "src/models/fsrs-6/parameters.ts", "src/models/fsrs-6/model.ts",
         "src/middlewares/learning-steps/core.ts", "src/middlewares/monotonic-interval/core.ts", "src/middlewares/fuzzing/core.ts",
         "src/legacy/impl/basic_scheduler.ts", "src/legacy/abstract_scheduler.ts", "src/legacy/help.ts", "src/legacy/default.ts", "src/help.ts"]
json.dump(paths, open("selection.json", "w"))
PY
NODE_OPTIONS=--max-old-space-size=4096 $REA analyze-javascript-application "$SRC" \
  --source-paths-json "$PWD/selection.json" --format json > app-evidence.json 2> app-stderr.log

# 4. 보기(view): 요약, 모듈 참조
E='{"kind":"evidence-file","path":"app-evidence.json"}'
echo "{\"source\":$E,\"view\":{\"kind\":\"summary\"}}" > view-summary.json
echo "{\"source\":$E,\"view\":{\"kind\":\"javascript\",\"collection\":\"modules\",\"projection\":\"references\",\"where\":{\"kind\":\"javascript-asset\"},\"offset\":0,\"limit\":64}}" > view-modules.json
for v in summary modules; do
  $REA inspect-analysis-view "view-$v.json" --format json > "app-$v-view.json"
done

# 5. 기능 추적: 알고리즘 모듈, 함수 호출자
python3 -I "$HERE/trace_inputs.py" "$WORK/work"
$REA trace-application-feature trace-feature-algorithm-input.json --format json > trace-feature-algorithm.json
for n in next-interval-callers schedule-days-callers learning-steps-callers forgetting-curve-callers; do
  $REA trace-javascript-semantics "trace-semantics-$n-input.json" --format json > "trace-semantics-$n.json"
done
