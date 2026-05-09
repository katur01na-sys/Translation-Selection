#!/bin/bash
# 导出翻译结果到 CSV（Excel 兼容）
DB="$HOME/Library/Application Support/polish-chiny/ch-pl-lqa/lqa.db"
OUT="$HOME/Desktop/暗流涌动_200条翻译审核结果.csv"

# UTF-8 BOM + header
printf '\xEF\xBB\xBF' > "$OUT"
echo '"序号","源文(中文)","翻译(波兰语)","AI修正译文","质量评分","性别"' >> "$OUT"

# 导出数据
sqlite3 -csv "$DB" "SELECT id, source, target, fixed_target, score, gender FROM segments ORDER BY id;" >> "$OUT"

echo "✅ 已导出到: $OUT"
wc -l "$OUT"
