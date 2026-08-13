import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import type {
  DashboardFilters,
  FilterOptionsResponse,
  ProjectFilterOption,
  ProjectSelection,
} from "../data/types";

type FilterMenu = "models" | "projects";

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

function ModelGlyph() {
  return (
    <svg className="filter-trigger-icon" viewBox="0 0 12 12" aria-hidden="true">
      <path d="M2.25 2.25h7.5v7.5h-7.5zM4 4h4M4 6h4M4 8h2" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" />
    </svg>
  );
}

function ProjectGlyph() {
  return (
    <svg className="filter-trigger-icon" viewBox="0 0 12 12" aria-hidden="true">
      <path d="M1.5 3.25h3l1 1.25h5v5.75h-9z" fill="none" stroke="currentColor" strokeWidth="1" strokeLinejoin="round" />
    </svg>
  );
}

function Chevron({ expanded }: { expanded: boolean }) {
  return (
    <svg className={`filter-trigger-chevron${expanded ? " is-expanded" : ""}`} viewBox="0 0 10 10" aria-hidden="true">
      <path d="m2 3.5 3 3 3-3" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function GroupChevron({ expanded }: { expanded: boolean }) {
  return (
    <svg className={`filter-group-chevron${expanded ? " is-expanded" : ""}`} viewBox="0 0 10 10" aria-hidden="true">
      <path d="m3.25 2 3 3-3 3" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function isGptModel(model: string): boolean {
  return /(?:^|[\/_:.\-])gpt(?:[-_.:/]|$)/i.test(model);
}

function modelList(options: FilterOptionsResponse | null, selected: readonly string[]): string[] {
  const values = [...(options?.models ?? []), ...selected];
  return [...new Set(values)];
}

function projectKey(project: ProjectFilterOption | ProjectSelection): string {
  if (project.kind === "project") return `project:${project.project_path}`;
  return project.kind;
}

function projectLabel(project: ProjectFilterOption | ProjectSelection): string {
  if (project.kind === "project") {
    return "project_name" in project ? project.project_name : project.project_path;
  }
  return project.kind === "projectless" ? "无项目会话" : "未识别项目";
}

function projectTitle(project: ProjectFilterOption | ProjectSelection): string | undefined {
  return project.kind === "project" ? project.project_path : undefined;
}

function projectSelections(options: FilterOptionsResponse | null, selected: readonly ProjectSelection[]): Array<ProjectFilterOption | ProjectSelection> {
  const values: Array<ProjectFilterOption | ProjectSelection> = [...(options?.projects ?? [])];
  const present = new Set(values.map(projectKey));
  for (const selection of selected) {
    if (!present.has(projectKey(selection))) values.push(selection);
  }
  return values;
}

function OptionStatus({
  optionsLoading,
  optionsStale,
  optionsErrorCode,
  hasOptions,
  onRetry,
}: Pick<FilterControlsProps, "optionsLoading" | "optionsStale" | "optionsErrorCode"> & {
  hasOptions: boolean;
  onRetry: () => void;
}) {
  if (optionsLoading) {
    return <div className="filter-options-status" role="status">选项加载中…</div>;
  }
  if (optionsErrorCode) {
    return (
      <div className="filter-options-status is-error" role="status">
        <span>选项加载失败</span>
        <button type="button" className="filter-options-retry" onClick={onRetry}>重试</button>
      </div>
    );
  }
  if (optionsStale) {
    return (
      <div className="filter-options-status is-stale" role="status">
        <span>{hasOptions ? "选项可能已更新" : "选项需要刷新"}</span>
        <button type="button" className="filter-options-retry" onClick={onRetry}>重试</button>
      </div>
    );
  }
  return null;
}

export function FilterControls({
  filters,
  options,
  optionsLoading,
  optionsStale,
  optionsErrorCode,
  anyFilterActive,
  onChange,
  onClear,
  onRetryOptions,
}: FilterControlsProps) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [openMenu, setOpenMenu] = useState<FilterMenu | null>(null);
  const [gptExpanded, setGptExpanded] = useState(true);

  useEffect(() => {
    const handlePointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpenMenu(null);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpenMenu(null);
    };
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, []);

  const models = useMemo(() => modelList(options, filters.models), [options, filters.models]);
  const gptModels = models.filter(isGptModel);
  const otherModels = models.filter((model) => !isGptModel(model));
  const selectedModels = new Set(filters.models);
  const selectedProjects = new Set(filters.projects.map(projectKey));
  const allGptSelected = gptModels.length > 0 && gptModels.every((model) => selectedModels.has(model));
  const someGptSelected = gptModels.some((model) => selectedModels.has(model));
  const projects = useMemo(() => projectSelections(options, filters.projects), [options, filters.projects]);

  const updateModels = (nextModels: string[]) => onChange({ ...filters, models: nextModels });
  const toggleModel = (model: string) => {
    const next = selectedModels.has(model)
      ? filters.models.filter((value) => value !== model)
      : [...filters.models, model];
    updateModels(next);
  };
  const toggleGpt = () => {
    if (allGptSelected) {
      updateModels(filters.models.filter((model) => !gptModels.includes(model)));
    } else {
      updateModels([...new Set([...filters.models, ...gptModels])]);
    }
  };
  const toggleProject = (project: ProjectFilterOption | ProjectSelection) => {
    const key = projectKey(project);
    let addition: ProjectSelection;
    if (project.kind === "project") addition = { kind: "project", project_path: project.project_path };
    else if (project.kind === "projectless") addition = { kind: "projectless" };
    else addition = { kind: "unknown" };
    const next: ProjectSelection[] = selectedProjects.has(key)
      ? filters.projects.filter((selection) => projectKey(selection) !== key)
      : [...filters.projects, addition];
    onChange({ ...filters, projects: next });
  };

  const menu = (kind: FilterMenu) => {
    if (openMenu !== kind) return null;
    const isModels = kind === "models";
    return (
      <div
        className="filter-popover"
        id={`${kind}-filter-options`}
        role="listbox"
        aria-label={isModels ? "模型选项" : "项目选项"}
        aria-multiselectable="true"
      >
        <OptionStatus
          optionsLoading={optionsLoading}
          optionsStale={optionsStale}
          optionsErrorCode={optionsErrorCode}
          hasOptions={isModels ? models.length > 0 : projects.length > 0}
          onRetry={onRetryOptions}
        />
        {!optionsLoading && isModels && models.length === 0 ? <div className="filter-options-empty">暂无模型</div> : null}
        {!optionsLoading && !isModels && projects.length === 0 ? <div className="filter-options-empty">暂无项目</div> : null}
        {isModels && gptModels.length > 0 ? (
          <div className="filter-group">
            <div className="filter-option filter-option-parent">
              <input
                ref={(element) => {
                  if (element) element.indeterminate = someGptSelected && !allGptSelected;
                }}
                type="checkbox"
                checked={allGptSelected}
                aria-checked={someGptSelected && !allGptSelected ? "mixed" : allGptSelected}
                aria-label="GPT"
                onChange={toggleGpt}
              />
              <button
                type="button"
                className="filter-group-toggle"
                aria-expanded={gptExpanded}
                onClick={() => setGptExpanded((expanded) => !expanded)}
              >
                <span>GPT</span>
                <GroupChevron expanded={gptExpanded} />
              </button>
            </div>
            {gptExpanded
              ? gptModels.map((model) => (
                  <label key={model} className={`filter-option filter-option-child${selectedModels.has(model) ? " is-selected" : ""}`}>
                    <input type="checkbox" checked={selectedModels.has(model)} aria-label={model} onChange={() => toggleModel(model)} />
                    <span className="filter-option-text" title={model}>{model}</span>
                  </label>
                ))
              : null}
          </div>
        ) : null}
        {isModels
          ? otherModels.map((model) => (
              <label key={model} className={`filter-option${selectedModels.has(model) ? " is-selected" : ""}`}>
                <input type="checkbox" checked={selectedModels.has(model)} aria-label={model} onChange={() => toggleModel(model)} />
                <span className="filter-option-text" title={model}>{model}</span>
              </label>
            ))
          : projects.map((project) => {
              const selected = selectedProjects.has(projectKey(project));
              return (
                <label key={projectKey(project)} className={`filter-option${selected ? " is-selected" : ""}`}>
                  <input type="checkbox" checked={selected} aria-label={projectLabel(project)} onChange={() => toggleProject(project)} />
                  <span className="filter-option-text" title={projectTitle(project)}>{projectLabel(project)}</span>
                </label>
              );
            })}
      </div>
    );
  };

  const trigger = (kind: FilterMenu, label: string, activeCount: number, icon: ReactNode) => {
    const active = activeCount > 0;
    const expanded = openMenu === kind;
    return (
      <div className="filter-selector">
        <button
          type="button"
          className={`filter-trigger${active ? " is-active" : ""}`}
          aria-label={`${label}筛选${active ? `，已选${activeCount}项` : "，全部"}`}
          aria-haspopup="listbox"
          aria-expanded={expanded}
          aria-controls={`${kind}-filter-options`}
          onClick={() => setOpenMenu((current) => current === kind ? null : kind)}
        >
          {icon}
          <span className="filter-trigger-label">{label}</span>
          <span className="filter-trigger-state">{active ? `${activeCount} 项` : "全部"}</span>
          <Chevron expanded={expanded} />
        </button>
        {menu(kind)}
      </div>
    );
  };

  return (
    <div className="filter-controls" ref={rootRef}>
      {trigger("models", "模型", filters.models.length, <ModelGlyph />)}
      {trigger("projects", "项目", filters.projects.length, <ProjectGlyph />)}
      {anyFilterActive ? <button type="button" className="clear-filters-button" onClick={onClear}>清除筛选</button> : null}
    </div>
  );
}
