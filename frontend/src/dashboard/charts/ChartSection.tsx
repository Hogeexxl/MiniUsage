import { projectDisplay } from "../shared/projectDisplay";
import { DistributionDonutCard } from "./DistributionDonutCard";
import { SkillsUsageChart } from "./SkillsUsageChart";
import type { DashboardChartsView } from "./useDashboardChartsController";

export function ChartSection({ view }: { view: DashboardChartsView }) {
  const modelItems = (view.models?.items ?? []).map((item) => ({
    id: item.model,
    label: item.model,
    totalTokens: item.usage.total_tokens,
    estimatedCost: item.usage.estimated_cost,
    estimatedCostStatus: item.usage.estimated_cost_status,
  }));
  const projectItems = (view.projects?.items ?? []).map((item) => {
    const project = item.kind === "project"
      ? { kind: "project" as const, project_name: item.project_name ?? item.project_path ?? "未识别项目", project_path: item.project_path ?? "" }
      : { kind: item.kind as "projectless" | "unknown" };
    const label = projectDisplay(project);
    return {
      id: item.kind === "project" ? item.project_path ?? label : item.kind,
      label,
      title: item.project_path ?? undefined,
      totalTokens: item.usage.total_tokens,
      estimatedCost: item.usage.estimated_cost,
      estimatedCostStatus: item.usage.estimated_cost_status,
    };
  });

  return (
    <section aria-label="使用分布图表" aria-busy={view.loading}>
      {view.error ? <div className="mb-3 text-xs text-destructive" role="status">图表数据加载失败</div> : null}
      <div className="grid grid-cols-2 gap-4 max-[1279px]:grid-cols-1">
        <DistributionDonutCard title="模型分布" items={modelItems} />
        <DistributionDonutCard title="项目分布" items={projectItems} />
      </div>
      <SkillsUsageChart response={view.skills} />
    </section>
  );
}
