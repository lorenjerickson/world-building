"use client";

import {
  type Activity,
  type ActivityGroup,
  type RemodelPlan,
} from "@/data/remodel-plan";
import { startTransition, useDeferredValue, useMemo, useState } from "react";

type ActivityStatus = "todo" | "done" | "skipped";

type ActivityState = Record<string, ActivityStatus>;

type ActivityWithGroup = Activity & {
  groupId: ActivityGroup["id"];
  groupTitle: string;
};

function buildInitialState(plan: RemodelPlan): ActivityState {
  return Object.fromEntries(
    plan.groups.flatMap((group) =>
      group.activities.map((activity) => [activity.id, "todo" as const]),
    ),
  );
}

function progressForGroup(group: ActivityGroup, statuses: ActivityState) {
  const completed = group.activities.filter(
    (activity) => statuses[activity.id] === "done",
  ).length;
  const skipped = group.activities.filter(
    (activity) => statuses[activity.id] === "skipped",
  ).length;

  return {
    completed,
    skipped,
    total: group.activities.length,
    percent: Math.round((completed / group.activities.length) * 100),
  };
}

function statusLabel(status: ActivityStatus) {
  if (status === "done") return "Completed";
  if (status === "skipped") return "Skipped";
  return "Open";
}

export function RemodelDashboard({ plan }: { plan: RemodelPlan }) {
  const [statuses, setStatuses] = useState<ActivityState>(() => buildInitialState(plan));
  const [selectedGroupId, setSelectedGroupId] = useState(plan.groups[0].id);
  const [selectedActivityId, setSelectedActivityId] = useState(
    plan.groups[0].activities[0].id,
  );
  const [query, setQuery] = useState("");

  const deferredQuery = useDeferredValue(query);

  const selectedGroup =
    plan.groups.find((group) => group.id === selectedGroupId) ?? plan.groups[0];

  const selectedActivity =
    plan.groups
      .flatMap((group) => group.activities)
      .find((activity) => activity.id === selectedActivityId) ??
    selectedGroup.activities[0];

  const totals = useMemo(() => {
    const allActivities = plan.groups.flatMap((group) => group.activities);
    const completed = allActivities.filter(
      (activity) => statuses[activity.id] === "done",
    ).length;
    const skipped = allActivities.filter(
      (activity) => statuses[activity.id] === "skipped",
    ).length;

    return {
      completed,
      skipped,
      total: allActivities.length,
      percent: Math.round((completed / allActivities.length) * 100),
    };
  }, [plan.groups, statuses]);

  const recommendations = useMemo(() => {
    return plan.groups
      .flatMap((group) =>
        group.activities.map((activity) => ({
          ...activity,
          groupId: group.id,
          groupTitle: group.title,
        })),
      )
      .filter((activity) => statuses[activity.id] === "todo")
      .sort((left, right) => {
        const impactScore = { High: 2, Medium: 1 };
        return impactScore[right.impact] - impactScore[left.impact];
      })
      .slice(0, 4);
  }, [plan.groups, statuses]);

  const filteredActivities = useMemo(() => {
    const normalizedQuery = deferredQuery.trim().toLowerCase();
    if (!normalizedQuery) {
      return selectedGroup.activities;
    }

    return selectedGroup.activities.filter((activity) => {
      const haystack = [
        activity.title,
        activity.description,
        activity.whyItMatters,
        activity.tags.join(" "),
      ]
        .join(" ")
        .toLowerCase();

      return haystack.includes(normalizedQuery);
    });
  }, [deferredQuery, selectedGroup.activities]);

  const nextBestAction = recommendations[0];

  function updateStatus(activityId: string, status: ActivityStatus) {
    setStatuses((current) => ({
      ...current,
      [activityId]: current[activityId] === status ? "todo" : status,
    }));
  }

  function openActivity(activity: ActivityWithGroup) {
    startTransition(() => {
      setSelectedGroupId(activity.groupId);
      setSelectedActivityId(activity.id);
    });
  }

  function openGroup(group: ActivityGroup) {
    startTransition(() => {
      setSelectedGroupId(group.id);
      setSelectedActivityId(group.activities[0].id);
      setQuery("");
    });
  }

  return (
    <main className="shell">
      <section className="app-frame">
        <aside className="sidebar">
          <div className="brand-block">
            <span className="eyebrow">Kitchen Remodel Navigator</span>
            <h1>Guide the project on your terms.</h1>
            <p>
              Track high-value decisions, skip what does not matter, and move
              through your remodel in any order that fits your reality.
            </p>
          </div>

          <div className="overall-progress">
            <div
              className="progress-ring"
              style={{ ["--progress" as string]: `${totals.percent}%` }}
            >
              <strong>{totals.percent}%</strong>
              <span>overall progress</span>
            </div>

            <div className="progress-copy">
              <p>
                {totals.completed} of {totals.total} activities completed
              </p>
              <p>{totals.skipped} skipped without affecting your path forward</p>
            </div>
          </div>

          <nav className="phase-nav" aria-label="Activity groups">
            {plan.groups.map((group) => {
              const progress = progressForGroup(group, statuses);
              const isActive = group.id === selectedGroupId;

              return (
                <button
                  key={group.id}
                  className={`phase-button ${isActive ? "active" : ""}`}
                  onClick={() => openGroup(group)}
                  type="button"
                >
                  <span className="phase-meta">{group.eyebrow}</span>
                  <span className="phase-title">{group.title}</span>
                  <span className="phase-summary">{group.goal}</span>
                  <span className="phase-progress">
                    {progress.completed}/{progress.total} completed
                  </span>
                </button>
              );
            })}
          </nav>
        </aside>

        <section className="workspace">
          <header className="topbar">
            <div>
              <span className="eyebrow">Project Snapshot</span>
              <h2>
                {plan.homeowner.firstName}&apos;s {plan.homeowner.projectName}
              </h2>
            </div>

            <div className="topbar-meta">
              <div>
                <span>Target Start</span>
                <strong>{plan.homeowner.targetStart}</strong>
              </div>
              <div>
                <span>Current Focus</span>
                <strong>{selectedGroup.title}</strong>
              </div>
            </div>
          </header>

          <section className="hero-grid">
            <article className="impact-panel">
              <span className="eyebrow">Recommended Next</span>
              <h3>{nextBestAction?.title}</h3>
              <p>{nextBestAction?.description}</p>
              <div className="impact-tags">
                <span>{nextBestAction?.groupTitle}</span>
                <span>{nextBestAction?.effort}</span>
                <span>{nextBestAction?.impact} impact</span>
              </div>
              {nextBestAction ? (
                <button
                  className="primary-action"
                  onClick={() => openActivity(nextBestAction)}
                  type="button"
                >
                  Open activity
                </button>
              ) : (
                <p className="empty-state">
                  You have finished or skipped every activity in this plan.
                </p>
              )}
            </article>

            <article className="metrics-strip">
              <div>
                <span>Completed</span>
                <strong>{totals.completed}</strong>
              </div>
              <div>
                <span>Open</span>
                <strong>{totals.total - totals.completed - totals.skipped}</strong>
              </div>
              <div>
                <span>Skipped</span>
                <strong>{totals.skipped}</strong>
              </div>
            </article>
          </section>

          <section className="recommendations">
            <div className="section-heading">
              <div>
                <span className="eyebrow">High-Value Activities</span>
                <h3>Suggested moves with outsized impact</h3>
              </div>
              <p>
                These recommendations stay flexible. You can open anything,
                complete it, or skip it whenever it stops being useful.
              </p>
            </div>

            <div className="recommendation-list">
              {recommendations.map((activity) => (
                <button
                  key={activity.id}
                  className="recommendation-item"
                  onClick={() => openActivity(activity)}
                  type="button"
                >
                  <div>
                    <span className="recommendation-group">{activity.groupTitle}</span>
                    <strong>{activity.title}</strong>
                    <p>{activity.whyItMatters}</p>
                  </div>
                  <span className="recommendation-meta">
                    {activity.impact} impact
                  </span>
                </button>
              ))}
            </div>
          </section>

          <section className="content-grid">
            <article className="activity-list-panel">
              <div className="section-heading">
                <div>
                  <span className="eyebrow">{selectedGroup.eyebrow}</span>
                  <h3>{selectedGroup.title}</h3>
                </div>
                <p>{selectedGroup.summary}</p>
              </div>

              <label className="search-field">
                <span>Search this activity group</span>
                <input
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Search by activity, material, or goal"
                  type="search"
                  value={query}
                />
              </label>

              <div className="activity-list">
                {filteredActivities.map((activity) => {
                  const isSelected = activity.id === selectedActivity.id;
                  const status = statuses[activity.id];

                  return (
                    <button
                      key={activity.id}
                      className={`activity-row ${isSelected ? "selected" : ""}`}
                      onClick={() =>
                        openActivity({
                          ...activity,
                          groupId: selectedGroup.id,
                          groupTitle: selectedGroup.title,
                        })
                      }
                      type="button"
                    >
                      <div>
                        <strong>{activity.title}</strong>
                        <p>{activity.description}</p>
                      </div>
                      <div className="activity-row-meta">
                        <span>{activity.effort}</span>
                        <span className={`status-pill status-${status}`}>
                          {statusLabel(status)}
                        </span>
                      </div>
                    </button>
                  );
                })}

                {filteredActivities.length === 0 ? (
                  <div className="empty-search">
                    No activities matched that search. Try a broader term like
                    storage, budget, or lighting.
                  </div>
                ) : null}
              </div>
            </article>

            <article className="detail-panel">
              <div className="detail-header">
                <span className="eyebrow">Selected Activity</span>
                <span className={`status-pill status-${statuses[selectedActivity.id]}`}>
                  {statusLabel(statuses[selectedActivity.id])}
                </span>
              </div>

              <h3>{selectedActivity.title}</h3>
              <p className="detail-description">{selectedActivity.description}</p>

              <div className="detail-grid">
                <div>
                  <span>Why it matters</span>
                  <p>{selectedActivity.whyItMatters}</p>
                </div>
                <div>
                  <span>Expected output</span>
                  <p>{selectedActivity.deliverable}</p>
                </div>
              </div>

              <div className="tag-row">
                {selectedActivity.tags.map((tag) => (
                  <span key={tag}>{tag}</span>
                ))}
              </div>

              <div className="detail-actions">
                <button
                  className="primary-action"
                  onClick={() => updateStatus(selectedActivity.id, "done")}
                  type="button"
                >
                  Mark complete
                </button>
                {selectedActivity.canSkip ? (
                  <button
                    className="secondary-action"
                    onClick={() => updateStatus(selectedActivity.id, "skipped")}
                    type="button"
                  >
                    Skip for now
                  </button>
                ) : (
                  <button className="secondary-action muted" disabled type="button">
                    Core activity
                  </button>
                )}
              </div>
            </article>
          </section>
        </section>
      </section>
    </main>
  );
}
