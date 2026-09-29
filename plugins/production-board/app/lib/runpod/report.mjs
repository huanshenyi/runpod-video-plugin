const cell=value=>String(value??'未確認').replace(/[\r\n|]/g,' ');
const money=value=>Number.isFinite(value)&&value>=0?`$${value.toFixed(4)}`:'未確認';
export function renderReport(run){
 const resources=run.resources??[],events=run.events??[],outputs=run.outputs??[];
 const remaining=resources.filter(resource=>resource.status!=='terminated'&&resource.status!=='deleted');
 const rows=events.filter(event=>event.startedAt&&event.endedAt).map(event=>{const seconds=(Date.parse(event.endedAt)-Date.parse(event.startedAt))/1000;return `| ${cell(event.phase??event.type)} | ${Number.isFinite(seconds)&&seconds>=0?seconds.toFixed(1):'未確認'} |`;});
 return [`# Runpod 実行報告`, ``, `- Run: ${cell(run.runId)}`,`- 状態: ${cell(run.status)}`,`- 実行方式: ${cell(run.execution?.mode)}${run.execution?.mode==='simulate'?'（模擬実行・課金なし・生成素材ではありません）':''}`,`- 生成結果: ${cell(run.outcome)}`,`- 削除確認: ${cell(run.cleanupStatus)}`,`- 開始: ${cell(run.createdAt)}`,`- 更新: ${cell(run.updatedAt)}`,`- 概算費用: ${money(run.estimatedCostUsd??run.cost?.estimatedUsd)}`,`- プロバイダー確認済み請求額: ${money(run.confirmedCostUsd??run.cost?.confirmedUsd)}`,``, `概算は請求確定額ではありません。未確認の課金・残存リソースはゼロとして扱いません。`,``, `## 段階別時間`, ``, `| 段階 | 秒 |`,`| --- | ---: |`,...rows,...(!rows.length?['| 計測記録なし | 未確認 |']:[]),``, `## 残存・状態未確認リソース`,``,...(remaining.length?remaining.map(resource=>`- ${cell(resource.type)} ${cell(resource.id)}: ${cell(resource.status)}`):['- 台帳上の残存記録なし（プロバイダー確認記録を参照）']),``, `## 出力`,``,...(outputs.length?outputs.map(output=>`- ${cell(output.path??output.localPath)} — ${cell(output.sha256)}`):['- なし']),``].join('\n');
}
