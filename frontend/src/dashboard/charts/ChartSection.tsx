import { DistributionDonutCard } from "./DistributionDonutCard";
import { SkillsUsageChart } from "./SkillsUsageChart";
import type { DashboardChartsView } from "./useDashboardChartsController";

export function ChartSection({ view }: { view: DashboardChartsView }) {
  const modelItems = (view.models?.items ?? []).map((item) => ({
    id: item.model, label: item.model, totalTokens: item.usage.total_tokens,
    estimatedCost: item.usage.estimated_cost, estimatedCostStatus: item.usage.estimated_cost_status,
  }));
  const projectItems = (view.projects?.items ?? []).map((item) => {
    const label = item.kind === "project" ? item.project_name ?? "未识别项目" : item.kind === "projectless" ? "无项目会话" : "未识别项目";
    return {
      id: item.kind === "project" ? item.project_path ?? label : item.kind,
      label,
      title: item.project_path ?? undefined,
      totalTokens: item.usage.total_tokens,
      estimatedCost: item.usage.estimated_cost,
      estimatedCostStatus: item.usage.estimated_cost_status,
    };
  });
  return <section className="charts-section" aria-label="使用分布图表" aria-busy={view.loading}>
    {view.error ? <div className="charts-error" role="status">图表数据加载失败</div> : null}
    <div className="distribution-grid">
      <DistributionDonutCard title="模型分布" items={modelItems} />
      <DistributionDonutCard title="项目分布" items={projectItems} />
    </div>
    <SkillsUsageChart response={view.skills} />
  </section>;
}
