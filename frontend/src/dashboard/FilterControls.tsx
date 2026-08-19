import { ChevronRight, Cpu, Folder } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import { useMemo, useState } from "react";

import type { DashboardFilters, FilterOptionsResponse, ProjectFilterOption, ProjectSelection } from "../data/types";
import { Button } from "../ui/beui/button";
import { Checkbox } from "../ui/beui/checkbox";
import { MorphPopover, MorphPopoverContent, MorphPopoverTrigger } from "../ui/beui/morph-popover";
import { projectDisplay, projectKey, projectTitle, type ProjectLike } from "./shared/projectDisplay";

type FilterControlsProps = {
  filters: DashboardFilters;
  options: FilterOptionsResponse | null;
  optionsLoading: boolean;
  optionsStale: boolean;
  optionsErrorCode?: string;
  anyFilterActive: boolean;
  onChange: (filters: DashboardFilters) => void;
  onClear: () => void;
  onRetryOptions: () => void;
};

function isGptModel(model: string): boolean {
  return /(?:^|[\/_:.\-])gpt(?:[-_.:/]|$)/i.test(model);
}

function modelList(options: FilterOptionsResponse | null, selected: readonly string[]): string[] {
  return [...new Set([...(options?.models ?? []), ...selected])];
}

function projectSelections(options: FilterOptionsResponse | null, selected: readonly ProjectSelection[]): ProjectLike[] {
  const values: ProjectLike[] = [...(options?.projects ?? [])];
  const present = new Set(values.map(projectKey));
  for (const selection of selected) if (!present.has(projectKey(selection))) values.push(selection);
  return values;
}

function OptionStatus({ loading, stale, error, hasOptions, onRetry }: { loading: boolean; stale: boolean; error?: string; hasOptions: boolean; onRetry: () => void }) {
  if (loading) return <div className="px-2 py-2 text-xs text-muted-foreground" role="status">选项加载中…</div>;
  if (error) return <div className="flex items-center justify-between gap-3 px-2 py-2 text-xs text-destructive" role="status"><span>选项加载失败</span><Button variant="ghost" size="sm" onClick={onRetry}>重试</Button></div>;
  if (stale) return <div className="flex items-center justify-between gap-3 px-2 py-2 text-xs text-warning" role="status"><span>{hasOptions ? "选项可能已更新" : "选项需要刷新"}</span><Button variant="ghost" size="sm" onClick={onRetry}>重试</Button></div>;
  return null;
}

function FilterTrigger({ label, count, icon }: { label: string; count: number; icon: React.ReactNode }) {
  const active = count > 0;
  return <Button variant={active ? "primary" : "secondary"} size="sm" aria-label={`${label}筛选${active ? `，已选${count}项` : "，全部"}`}><span className="inline-flex h-4 w-4 items-center justify-center">{icon}</span><span>{label} · {active ? `${count} 项` : "全部"}</span></Button>;
}

export function FilterControls({ filters, options, optionsLoading, optionsStale, optionsErrorCode, anyFilterActive, onChange, onClear, onRetryOptions }: FilterControlsProps) {
  const [gptExpanded, setGptExpanded] = useState(true);
  const reduce = useReducedMotion();
  const models = useMemo(() => modelList(options, filters.models), [options, filters.models]);
  const projects = useMemo(() => projectSelections(options, filters.projects), [options, filters.projects]);
  const gptModels = models.filter(isGptModel);
  const otherModels = models.filter((model) => !isGptModel(model));
  const selectedModels = new Set(filters.models);
  const selectedProjects = new Set(filters.projects.map(projectKey));
  const allGptSelected = gptModels.length > 0 && gptModels.every((model) => selectedModels.has(model));
  const someGptSelected = gptModels.some((model) => selectedModels.has(model));

  const updateModels = (nextModels: string[]) => onChange({ ...filters, models: nextModels });
  const toggleModel = (model: string) => updateModels(selectedModels.has(model) ? filters.models.filter((value) => value !== model) : [...filters.models, model]);
  const toggleGpt = () => updateModels(allGptSelected ? filters.models.filter((model) => !gptModels.includes(model)) : [...new Set([...filters.models, ...gptModels])]);
  const toggleProject = (project: ProjectFilterOption | ProjectSelection) => {
    const key = projectKey(project);
    const addition: ProjectSelection = project.kind === "project" ? { kind: "project", project_path: project.project_path } : { kind: project.kind };
    onChange({ ...filters, projects: selectedProjects.has(key) ? filters.projects.filter((selection) => projectKey(selection) !== key) : [...filters.projects, addition] });
  };

  const rowClass = "flex min-h-9 w-full items-center gap-2 rounded-xl px-2 py-1.5 text-left text-sm text-foreground hover:bg-primary/5";

  return (
    <div className="flex flex-wrap items-center gap-2">
      <MorphPopover>
        <MorphPopoverTrigger><FilterTrigger label="模型" count={filters.models.length} icon={<Cpu className="h-4 w-4" />} /></MorphPopoverTrigger>
        <MorphPopoverContent side="bottom" align="start" className="w-72 p-2">
          <OptionStatus loading={optionsLoading} stale={optionsStale} error={optionsErrorCode} hasOptions={models.length > 0} onRetry={onRetryOptions} />
          {!optionsLoading && models.length === 0 ? <div className="px-2 py-3 text-xs text-muted-foreground">暂无模型</div> : null}
          {gptModels.length > 0 ? <div>
            <div className={rowClass}>
              <Checkbox checked={allGptSelected} indeterminate={someGptSelected && !allGptSelected} aria-label="GPT" onCheckedChange={toggleGpt} />
              <button type="button" className="flex min-w-0 flex-1 items-center gap-1.5 text-left" aria-expanded={gptExpanded} onClick={() => setGptExpanded((value) => !value)}><span className="flex-1">GPT</span><motion.span animate={{ rotate: gptExpanded ? 90 : 0 }} transition={reduce ? { duration: 0 } : { duration: 0.18 }}><ChevronRight className="h-4 w-4 text-muted-foreground" /></motion.span></button>
            </div>
            {gptExpanded ? <div className="pl-5">{gptModels.map((model) => <div key={model} className={rowClass}><Checkbox checked={selectedModels.has(model)} aria-label={model} onCheckedChange={() => toggleModel(model)} /><span className="min-w-0 truncate" title={model}>{model}</span></div>)}</div> : null}
          </div> : null}
          {otherModels.map((model) => <div key={model} className={rowClass}><Checkbox checked={selectedModels.has(model)} aria-label={model} onCheckedChange={() => toggleModel(model)} /><span className="min-w-0 truncate" title={model}>{model}</span></div>)}
        </MorphPopoverContent>
      </MorphPopover>

      <MorphPopover>
        <MorphPopoverTrigger><FilterTrigger label="项目" count={filters.projects.length} icon={<Folder className="h-4 w-4" />} /></MorphPopoverTrigger>
        <MorphPopoverContent side="bottom" align="start" className="w-80 p-2">
          <OptionStatus loading={optionsLoading} stale={optionsStale} error={optionsErrorCode} hasOptions={projects.length > 0} onRetry={onRetryOptions} />
          {!optionsLoading && projects.length === 0 ? <div className="px-2 py-3 text-xs text-muted-foreground">暂无项目</div> : null}
          {projects.map((project) => <div key={projectKey(project)} className={rowClass}><Checkbox checked={selectedProjects.has(projectKey(project))} aria-label={projectDisplay(project)} onCheckedChange={() => toggleProject(project)} /><span className="min-w-0 truncate" title={projectTitle(project)}>{projectDisplay(project)}</span></div>)}
        </MorphPopoverContent>
      </MorphPopover>

      {anyFilterActive ? <Button variant="ghost" size="sm" onClick={onClear}>清除筛选</Button> : null}
    </div>
  );
}
