import { getProject, getTask, listProjects, listProjectTasks, listTasks } from "../dolibarr/projects.js";
import { dolibarrLikeLiteral, dolibarrQueryString } from "../dolibarr/sqlFilters.js";
import { resolveByIdOrRef } from "../tools/shared/resolveByIdOrRef.js";
import { resolveMissingThirdpartyNames } from "../tools/shared/thirdpartyNames.js";
import { cleanString, numberOrUndefined } from "../tools/shared/normalization.js";
import type { DolibarrProject, DolibarrTask } from "../types/dolibarr.js";
import type { McpError, RecordCandidate } from "../types/tools.js";

export type ProjectResolveResult =
  | { ok: true; project: DolibarrProject }
  | { ok: false; error: McpError };

export type TaskResolveResult =
  | { ok: true; task: DolibarrTask; project?: DolibarrProject }
  | { ok: false; error: McpError };

const titleMatchLimit = 10;

function sameText(a: string | undefined, b: string): boolean {
  return (a ?? "").trim().toLowerCase() === b.trim().toLowerCase();
}

async function projectCandidates(projects: DolibarrProject[]): Promise<RecordCandidate[]> {
  const names = await resolveMissingThirdpartyNames(
    projects.flatMap((project) => numberOrUndefined(project.socid) ?? []).filter((id) => id > 0),
  );
  return projects.map((project) => {
    const socid = numberOrUndefined(project.socid);
    return {
      id: Number(project.id),
      ref: project.ref,
      label: cleanString(project.title),
      client_name: socid ? names.get(socid) : undefined,
    };
  });
}

function taskCandidates(tasks: DolibarrTask[]): RecordCandidate[] {
  return tasks.map((task) => ({ id: Number(task.id), ref: task.ref, label: cleanString(task.label) }));
}

/**
 * Resolve a project from a Dolibarr ID, an exact ref (for example PJ2511-0004)
 * or a title. A title matches by substring; one exact title match wins over
 * other partial matches. `thirdpartyId` narrows the title search.
 */
export async function resolveProject(
  value: string,
  options: { thirdpartyId?: number } = {},
): Promise<ProjectResolveResult> {
  const trimmed = value.trim();
  const direct = await resolveByIdOrRef(trimmed, { getById: getProject, list: listProjects });
  if (direct) return { ok: true, project: direct };

  const matches = await listProjects(dolibarrQueryString({
    sqlfilters: `(t.title:like:${dolibarrLikeLiteral(trimmed)})`,
    sortfield: "t.rowid",
    sortorder: "DESC",
    limit: String(titleMatchLimit),
    ...(options.thirdpartyId !== undefined ? { thirdparty_ids: String(options.thirdpartyId) } : {}),
  }));

  const exact = matches.filter((project) => sameText(project.title, trimmed));
  const pick = exact.length === 1 ? exact : matches;

  if (pick.length === 1) return { ok: true, project: pick[0] };

  if (pick.length === 0) {
    return {
      ok: false,
      error: {
        error: "PROJECT_NOT_FOUND",
        message: `No project found for '${trimmed}'.`,
        action: "Run list_projects to find the project ref or ID, or create_project to create it.",
      },
    };
  }

  return {
    ok: false,
    error: {
      error: "PROJECT_AMBIGUOUS",
      message: `Found ${pick.length} projects matching '${trimmed}'. Please confirm which one to use.`,
      candidates: await projectCandidates(pick),
    },
  };
}

function matchTaskByLabel(tasks: DolibarrTask[], label: string): DolibarrTask[] {
  const exact = tasks.filter((task) => sameText(task.label, label) || sameText(task.ref, label));
  if (exact.length > 0) return exact;
  const needle = label.trim().toLowerCase();
  return tasks.filter((task) => (task.label ?? "").toLowerCase().includes(needle));
}

/**
 * Resolve a task from its ID or ref, or from a label within a project. With a
 * project and no task, the project's only task is used; several tasks return
 * TASK_AMBIGUOUS with the list to choose from.
 */
export async function resolveTask(input: { task?: string; project?: string }): Promise<TaskResolveResult> {
  const taskInput = input.task?.trim();

  let project: DolibarrProject | undefined;
  if (input.project !== undefined) {
    const resolved = await resolveProject(input.project);
    if (!resolved.ok) return resolved;
    project = resolved.project;
  }

  if (taskInput) {
    const direct = await resolveByIdOrRef(taskInput, { getById: getTask, list: listTasks });
    if (direct && (!project || Number(direct.fk_project) === Number(project.id))) {
      return { ok: true, task: direct, project };
    }
  }

  if (!project) {
    return {
      ok: false,
      error: {
        error: "TASK_NOT_FOUND",
        message: taskInput ? `No task found with ID or ref '${taskInput}'.` : "No task or project given.",
        action: "Pass the task ID or ref, or pass project together with the task label.",
      },
    };
  }

  const tasks = await listProjectTasks(Number(project.id));
  const matches = taskInput ? matchTaskByLabel(tasks, taskInput) : tasks;

  if (matches.length === 1) {
    // The project task list is a light shape; fetch the full task.
    return { ok: true, task: await getTask(Number(matches[0].id)), project };
  }

  if (matches.length === 0) {
    return {
      ok: false,
      error: {
        error: "TASK_NOT_FOUND",
        message: tasks.length === 0
          ? `Project ${project.ref} has no tasks.`
          : `No task matching '${taskInput}' in project ${project.ref}.`,
        action: "Run create_task to add the task, or pick one of the candidates.",
        ...(tasks.length > 0 ? { candidates: taskCandidates(tasks) } : {}),
      },
    };
  }

  return {
    ok: false,
    error: {
      error: "TASK_AMBIGUOUS",
      message: taskInput
        ? `Found ${matches.length} tasks matching '${taskInput}' in project ${project.ref}. Please confirm which one to use.`
        : `Project ${project.ref} has ${matches.length} tasks. Please say which task to use.`,
      candidates: taskCandidates(matches),
    },
  };
}
