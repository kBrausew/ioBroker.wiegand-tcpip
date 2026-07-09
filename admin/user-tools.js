/* eslint-disable no-undef */
/* eslint-disable no-console */

(function () {
  const ACTION_BUTTON_IDS = [
    "#ops_user_list",
    "#ops_import_preview",
    "#ops_import_apply",
    "#ops_review_list",
    "#ops_review_approve",
    "#ops_review_refresh_table",
    "#ops_review_apply_selected",
    "#ops_sync_preview",
    "#ops_sync_apply",
    "#ops_validate",
    "#ops_reconcile",
    "#ops_restore_preview",
    "#ops_restore_apply",
    "#ops_job_list",
  ];

  function parseCsvNumbers(rawValue) {
    if (!rawValue || typeof rawValue !== "string") {
      return [];
    }
    return rawValue
      .split(",")
      .map((item) => parseInt(item.trim(), 10))
      .filter((item) => !isNaN(item));
  }

  function parseCsvStrings(rawValue) {
    if (!rawValue || typeof rawValue !== "string") {
      return [];
    }
    return rawValue
      .split(",")
      .map((item) => item.trim())
      .filter((item) => item.length > 0);
  }

  function pretty(data) {
    try {
      return JSON.stringify(data, null, 2);
    } catch (_err) {
      return String(data);
    }
  }

  function nowIso() {
    return new Date().toISOString();
  }

  function escapeHtml(value) {
    const raw = value == null ? "" : String(value);
    return raw
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function summarizeCredentials(review) {
    const credentials = Array.isArray(review?.record?.credentials)
      ? review.record.credentials
      : [];

    if (credentials.length === 0) {
      return "-";
    }

    return credentials
      .map((credential) => {
        const type = credential?.type || "?";
        const value = credential?.value == null ? "?" : credential.value;
        const controllers = Array.isArray(credential?.controllers)
          ? credential.controllers.join(",")
          : "";
        return `${type}:${value}${controllers ? `@${controllers}` : ""}`;
      })
      .join(" | ");
  }

  function summarizeJobs(jobListResponse) {
    const jobs = Array.isArray(jobListResponse?.jobs) ? jobListResponse.jobs : [];
    const summary = {
      total: jobs.length,
      running: 0,
      completed: 0,
      failed: 0,
    };

    for (const job of jobs) {
      const status = String(job?.status || "").toLowerCase();
      if (status === "running" || status === "queued") {
        summary.running += 1;
      } else if (status === "completed") {
        summary.completed += 1;
      } else if (status === "failed") {
        summary.failed += 1;
      }
    }

    return summary;
  }

  class UserToolsPanel {
    constructor() {
      this.datasetTemplate = {
        source: "admin-ui",
        controllers: [
          {
            serial: 405419896,
            entries: [
              {
                displayName: "UI Import User",
                card: 90010001,
                pin: "1111",
                externalId: "ui-user-90010001",
              },
            ],
          },
        ],
      };

      this.state = {
        busy: false,
        lastCommand: "-",
        lastStatus: "idle",
        lastUpdatedAt: "-",
        lastAutoRefreshAt: "-",
        pendingReviews: 0,
        jobs: {
          total: 0,
          running: 0,
          completed: 0,
          failed: 0,
        },
      };

      this.reviewRows = [];
      this.reviewDecisions = {};
      this.autoRefreshTimer = null;
      this.autoRefreshMs = 5000;
    }

    init() {
      this.opsDataset = $("#ops_dataset");
      this.opsOutput = $("#ops_output");
      this.syncMode = $("#ops_sync_mode");
      this.background = $("#ops_background");
      this.userIds = $("#ops_user_ids");
      this.controllerIds = $("#ops_controller_ids");
      this.statusBadge = $("#ops_status_badge");
      this.lastCommandValue = $("#ops_last_command");
      this.lastUpdatedValue = $("#ops_last_updated");
      this.pendingReviewsValue = $("#ops_pending_reviews");
      this.jobsRunningValue = $("#ops_jobs_running");
      this.jobsSummaryValue = $("#ops_jobs_summary");
      this.autoRefreshAtValue = $("#ops_auto_refresh_at");
      this.reviewTableBody = $("#ops_review_table_body");
      this.reviewPendingTable = $("#ops_review_pending_table");
      this.reviewFilterStatus = $("#ops_review_filter_status");
      this.reviewFilterType = $("#ops_review_filter_type");
      this.reviewFilterText = $("#ops_review_filter_text");
      this.reviewAutoRefresh = $("#ops_review_auto_refresh");
      this.reviewRefreshSeconds = $("#ops_review_refresh_seconds");

      if (!this.opsDataset.val()) {
        this.opsDataset.val(pretty(this.datasetTemplate));
      }

      this.bindActions();
      this.renderState();
      if (M && M.updateTextFields) {
        M.updateTextFields();
      }
      if (this.syncMode.formSelect) {
        this.syncMode.formSelect();
      }
      if (this.reviewFilterStatus.formSelect) {
        this.reviewFilterStatus.formSelect();
      }
      if (this.reviewFilterType.formSelect) {
        this.reviewFilterType.formSelect();
      }
      if (this.reviewRefreshSeconds.formSelect) {
        this.reviewRefreshSeconds.formSelect();
      }

      this.updateAutoRefreshInterval();
    }

    bindActions() {
      $("#ops_user_list").on("click", () => this.runUserList());
      $("#ops_import_preview").on("click", () => this.runImportPreview());
      $("#ops_import_apply").on("click", () => this.runImportApply());
      $("#ops_review_list").on("click", () => this.runReviewList());
      $("#ops_review_approve").on("click", () => this.runReviewApprovePending());
      $("#ops_sync_preview").on("click", () => this.runSyncPreview());
      $("#ops_sync_apply").on("click", () => this.runSyncApply());
      $("#ops_validate").on("click", () => this.runValidate());
      $("#ops_reconcile").on("click", () => this.runReconcilePreview());
      $("#ops_restore_preview").on("click", () => this.runRestorePreview());
      $("#ops_restore_apply").on("click", () => this.runRestoreApply());
      $("#ops_job_list").on("click", () => this.runJobList());
      $("#ops_review_refresh_table").on("click", () => this.runReviewTableRefresh());
      $("#ops_review_apply_selected").on("click", () => this.runReviewApplySelected());

      this.reviewTableBody.on("change", ".ops-review-decision", (event) => {
        const element = $(event.currentTarget);
        const reviewId = String(element.data("review-id") || "");
        if (!reviewId) {
          return;
        }

        const nextAction = String(element.val() || "auto");
        const current = this.reviewDecisions[reviewId] || {};
        this.reviewDecisions[reviewId] = Object.assign({}, current, {
          action: nextAction,
        });
      });

      this.reviewTableBody.on("input", ".ops-review-userid", (event) => {
        const element = $(event.currentTarget);
        const reviewId = String(element.data("review-id") || "");
        if (!reviewId) {
          return;
        }

        const nextUserId = String(element.val() || "").trim();
        const current = this.reviewDecisions[reviewId] || {};
        this.reviewDecisions[reviewId] = Object.assign({}, current, {
          userId: nextUserId,
        });
      });

      this.reviewFilterStatus.on("change", () => this.renderReviewTable());
      this.reviewFilterType.on("change", () => this.renderReviewTable());
      this.reviewFilterText.on("input", () => this.renderReviewTable());

      this.reviewRefreshSeconds.on("change", () => {
        this.updateAutoRefreshInterval();
        this.configureAutoRefresh();
      });

      this.reviewAutoRefresh.on("change", () => {
        this.configureAutoRefresh();
      });
    }

    updateAutoRefreshInterval() {
      const seconds = parseInt(String(this.reviewRefreshSeconds.val() || "5"), 10);
      this.autoRefreshMs = isNaN(seconds) || seconds < 1 ? 5000 : seconds * 1000;
    }

    configureAutoRefresh() {
      const enabled = !!this.reviewAutoRefresh.prop("checked");

      if (this.autoRefreshTimer) {
        clearInterval(this.autoRefreshTimer);
        this.autoRefreshTimer = null;
      }

      if (!enabled) {
        return;
      }

      this.autoRefreshTimer = setInterval(() => {
        this.runSilentReviewAndJobRefresh();
      }, this.autoRefreshMs);
    }

    async runSilentReviewAndJobRefresh() {
      if (this.state.busy || document.hidden) {
        return;
      }

      try {
        const reviewResponse = await this.send("userImportReviewList", {});
        this.updateMetricsFromResponse("userImportReviewList", reviewResponse);
        const reviews = Array.isArray(reviewResponse?.reviews) ? reviewResponse.reviews : [];
        this.reviewRows = reviews;
        this.renderReviewTable();

        const jobResponse = await this.send("userJobList", {});
        this.updateMetricsFromResponse("userJobList", jobResponse);
        this.setState({ lastAutoRefreshAt: nowIso() });
      } catch (_err) {
        // Silent refresh intentionally ignores transient errors.
      }
    }

    setBusy(isBusy) {
      this.state.busy = isBusy;
      for (const selector of ACTION_BUTTON_IDS) {
        const button = $(selector);
        if (isBusy) {
          button.addClass("disabled");
        } else {
          button.removeClass("disabled");
        }
      }
      this.renderState();
    }

    setState(partial) {
      this.state = Object.assign({}, this.state, partial || {});
      this.renderState();
    }

    setJobsState(jobsSummary) {
      this.state.jobs = Object.assign({}, this.state.jobs, jobsSummary || {});
      this.renderState();
    }

    renderState() {
      if (this.statusBadge && this.statusBadge.length > 0) {
        this.statusBadge.removeClass("ops-status-idle ops-status-running ops-status-ok ops-status-error");

        let label = "idle";
        if (this.state.busy) {
          this.statusBadge.addClass("ops-status-running");
          label = "running";
        } else if (this.state.lastStatus === "error") {
          this.statusBadge.addClass("ops-status-error");
          label = "error";
        } else if (this.state.lastStatus === "ok") {
          this.statusBadge.addClass("ops-status-ok");
          label = "ok";
        } else {
          this.statusBadge.addClass("ops-status-idle");
        }

        this.statusBadge.text(label);
      }

      if (this.lastCommandValue && this.lastCommandValue.length > 0) {
        this.lastCommandValue.text(String(this.state.lastCommand || "-"));
      }

      if (this.lastUpdatedValue && this.lastUpdatedValue.length > 0) {
        this.lastUpdatedValue.text(String(this.state.lastUpdatedAt || "-"));
      }

      if (this.pendingReviewsValue && this.pendingReviewsValue.length > 0) {
        this.pendingReviewsValue.text(String(this.state.pendingReviews || 0));
      }

      if (this.reviewPendingTable && this.reviewPendingTable.length > 0) {
        this.reviewPendingTable.text(String(this.state.pendingReviews || 0));
      }

      if (this.jobsRunningValue && this.jobsRunningValue.length > 0) {
        this.jobsRunningValue.text(String(this.state.jobs.running || 0));
      }

      if (this.jobsSummaryValue && this.jobsSummaryValue.length > 0) {
        const jobs = this.state.jobs || {};
        const summary = `${jobs.total || 0} total / ${jobs.completed || 0} done / ${jobs.failed || 0} failed`;
        this.jobsSummaryValue.text(summary);
      }

      if (this.autoRefreshAtValue && this.autoRefreshAtValue.length > 0) {
        this.autoRefreshAtValue.text(String(this.state.lastAutoRefreshAt || "-"));
      }
    }

    showResult(title, data) {
      const stamp = nowIso();
      this.opsOutput.val(`${stamp} | ${title}\n${pretty(data)}`);
      if (M && M.textareaAutoResize) {
        M.textareaAutoResize(this.opsOutput);
      }
      if (M && M.updateTextFields) {
        M.updateTextFields();
      }
    }

    send(command, message) {
      return new Promise((resolve) => {
        sendTo(null, command, message || {}, (response) => {
          resolve(response);
        });
      });
    }

    getDataset() {
      const raw = this.opsDataset.val() || "{}";
      try {
        return JSON.parse(raw);
      } catch (err) {
        throw new Error(`Invalid dataset JSON: ${err.message}`);
      }
    }

    getScopePayload() {
      const payload = {
        mode: (this.syncMode.val() || "overwrite").toString(),
      };

      const userIds = parseCsvStrings(this.userIds.val());
      if (userIds.length > 0) {
        payload.userIds = userIds;
      }

      const controllerIds = parseCsvNumbers(this.controllerIds.val());
      if (controllerIds.length > 0) {
        payload.controllerIds = controllerIds;
      }

      return payload;
    }

    updateMetricsFromResponse(command, response) {
      if (command === "userImportPreview") {
        const pending = Number(response?.preview?.pendingReviews || 0);
        if (!isNaN(pending)) {
          this.setState({ pendingReviews: pending });
        }
      }

      if (command === "userImportReviewList") {
        const reviews = Array.isArray(response?.reviews) ? response.reviews : [];
        const pending = reviews.filter((item) => item && item.status === "pending").length;
        this.setState({ pendingReviews: pending });
      }

      if (command === "userJobList") {
        this.setJobsState(summarizeJobs(response));
      }
    }

    getFilteredReviews() {
      const statusFilter = String(this.reviewFilterStatus.val() || "all").toLowerCase();
      const typeFilter = String(this.reviewFilterType.val() || "all").toLowerCase();
      const textFilter = String(this.reviewFilterText.val() || "").trim().toLowerCase();

      return this.reviewRows.filter((review) => {
        if (!review) {
          return false;
        }

        const status = String(review.status || "").toLowerCase();
        const decisionType = String(review.decisionType || "").toLowerCase();
        const reviewId = String(review.id || "").toLowerCase();
        const suggestedUserId = String(review.suggestedUserId || "").toLowerCase();

        if (statusFilter !== "all" && status !== statusFilter) {
          return false;
        }

        if (typeFilter !== "all" && decisionType !== typeFilter) {
          return false;
        }

        if (textFilter.length > 0 && !reviewId.includes(textFilter) && !suggestedUserId.includes(textFilter)) {
          return false;
        }

        return true;
      });
    }

    renderReviewTable(reviews) {
      if (Array.isArray(reviews)) {
        this.reviewRows = reviews;
      }

      const pendingRows = this.reviewRows.filter((item) => item && item.status === "pending");
      this.setState({ pendingReviews: pendingRows.length });

      const visibleRows = this.getFilteredReviews();

      if (!this.reviewTableBody || this.reviewTableBody.length === 0) {
        return;
      }

      this.reviewTableBody.empty();
      if (visibleRows.length === 0) {
        this.reviewTableBody.append(
          '<tr><td colspan="7" class="ops-muted">No review entries available.</td></tr>',
        );
        return;
      }

      for (const review of visibleRows) {
        const reviewId = String(review?.id || "");
        const status = String(review?.status || "-");
        const decisionType = String(review?.decisionType || "-");
        const suggestedUserId = String(review?.suggestedUserId || "-");
        const credentialsSummary = summarizeCredentials(review);

        const existing = this.reviewDecisions[reviewId] || {
          action: "auto",
          userId: String(review?.suggestedUserId || ""),
        };
        this.reviewDecisions[reviewId] = existing;

        const isPending = status === "pending";
        const disabledAttr = isPending ? "" : ' disabled="disabled"';
        const options = [
          `<option value="auto"${existing.action === "auto" ? " selected" : ""}>auto</option>`,
          `<option value="create"${existing.action === "create" ? " selected" : ""}>create</option>`,
          `<option value="merge"${existing.action === "merge" ? " selected" : ""}>merge</option>`,
          `<option value="reject"${existing.action === "reject" ? " selected" : ""}>reject</option>`,
        ].join("");

        const rowHtml = `
          <tr>
            <td>${escapeHtml(reviewId || "-")}</td>
            <td>${escapeHtml(status)}</td>
            <td>${escapeHtml(decisionType)}</td>
            <td>${escapeHtml(suggestedUserId)}</td>
            <td class="ops-review-credentials">${escapeHtml(credentialsSummary)}</td>
            <td>
              <select class="ops-review-decision" data-review-id="${escapeHtml(reviewId)}"${disabledAttr}>
                ${options}
              </select>
            </td>
            <td>
              <input
                class="ops-review-userid"
                data-review-id="${escapeHtml(reviewId)}"
                type="text"
                value="${escapeHtml(existing.userId || "")}"
                placeholder="optional for merge"
                ${disabledAttr}
              />
            </td>
          </tr>
        `;

        this.reviewTableBody.append(rowHtml);
      }
    }

    async fetchReviewList() {
      const response = await this.send("userImportReviewList", {});
      const reviews = Array.isArray(response?.reviews) ? response.reviews : [];
      this.reviewRows = reviews;
      this.renderReviewTable();
      return response;
    }

    resolveDecisionForReview(review, decision) {
      const requested = String(decision?.action || "auto");
      let action = requested;

      if (requested === "auto") {
        action = review?.decisionType === "merge" ? "merge" : "create";
      }

      return {
        action,
        userId: String(decision?.userId || "").trim(),
      };
    }

    async runAction(title, command, buildMessage) {
      if (this.state.busy) {
        return;
      }

      this.setBusy(true);
      this.setState({
        lastCommand: command,
        lastStatus: "running",
        lastUpdatedAt: nowIso(),
      });

      try {
        const message = typeof buildMessage === "function" ? buildMessage() : (buildMessage || {});
        const response = await this.send(command, message);
        const hasError = !!response?.error;

        this.updateMetricsFromResponse(command, response);

        this.showResult(title, response);
        this.setState({
          lastStatus: hasError ? "error" : "ok",
          lastUpdatedAt: nowIso(),
        });
      } catch (err) {
        this.showResult(`${title} (client error)`, {
          error: err && err.message ? err.message : String(err),
        });
        this.setState({
          lastStatus: "error",
          lastUpdatedAt: nowIso(),
        });
      } finally {
        this.setBusy(false);
      }
    }

    async runUserList() {
      return this.runAction("userList", "userList", {});
    }

    async runImportPreview() {
      return this.runAction("userImportPreview", "userImportPreview", () => ({
        dataset: this.getDataset(),
      }));
    }

    async runImportApply() {
      return this.runAction("userImportApply", "userImportApply", () => ({
        dataset: this.getDataset(),
        background: !!this.background.prop("checked"),
      }));
    }

    async runReviewList() {
      if (this.state.busy) {
        return;
      }

      this.setBusy(true);
      this.setState({
        lastCommand: "userImportReviewList",
        lastStatus: "running",
        lastUpdatedAt: nowIso(),
      });

      try {
        const response = await this.fetchReviewList();
        this.showResult("userImportReviewList", response);
        this.setState({
          lastStatus: response?.error ? "error" : "ok",
          lastUpdatedAt: nowIso(),
        });
      } catch (err) {
        this.showResult("userImportReviewList (client error)", {
          error: err && err.message ? err.message : String(err),
        });
        this.setState({
          lastStatus: "error",
          lastUpdatedAt: nowIso(),
        });
      } finally {
        this.setBusy(false);
      }
    }

    async runReviewApprovePending() {
      if (this.state.busy) {
        return;
      }

      this.setBusy(true);
      this.setState({
        lastCommand: "userImportReviewApprove",
        lastStatus: "running",
        lastUpdatedAt: nowIso(),
      });

      try {
        const reviewList = await this.send("userImportReviewList", {});
        const reviews = Array.isArray(reviewList?.reviews) ? reviewList.reviews : [];
        const pending = reviews.filter((item) => item && item.status === "pending");

        const approved = [];
        for (const review of pending) {
          const action = review.decisionType === "merge" ? "merge" : "create";
          const response = await this.send("userImportReviewApprove", {
            reviewId: review.id,
            action,
            userId: review.suggestedUserId,
          });
          approved.push({ id: review.id, response });
        }

        const allOk = approved.every((entry) => !entry?.response?.error);
        this.setState({
          pendingReviews: 0,
          lastStatus: allOk ? "ok" : "error",
          lastUpdatedAt: nowIso(),
        });

        this.showResult("userImportReviewApprove (pending)", {
          totalPending: pending.length,
          approved,
        });
      } catch (err) {
        this.showResult("userImportReviewApprove (client error)", {
          error: err && err.message ? err.message : String(err),
        });
        this.setState({
          lastStatus: "error",
          lastUpdatedAt: nowIso(),
        });
      } finally {
        this.setBusy(false);
      }
    }

    async runReviewTableRefresh() {
      return this.runReviewList();
    }

    async runReviewApplySelected() {
      if (this.state.busy) {
        return;
      }

      this.setBusy(true);
      this.setState({
        lastCommand: "userImportReviewApplySelected",
        lastStatus: "running",
        lastUpdatedAt: nowIso(),
      });

      try {
        const listResponse = await this.fetchReviewList();
        const reviews = Array.isArray(listResponse?.reviews) ? listResponse.reviews : [];
        const pending = reviews.filter((item) => item && item.status === "pending");

        if (pending.length > 5) {
          const confirmed = window.confirm(
            `You are about to apply ${pending.length} pending review decisions. Continue?`,
          );
          if (!confirmed) {
            this.showResult("userImportReviewApplySelected", {
              cancelled: true,
              reason: "user-declined-confirmation",
              totalPending: pending.length,
            });
            this.setState({
              lastStatus: "ok",
              lastUpdatedAt: nowIso(),
            });
            return;
          }
        }

        const results = [];
        for (const review of pending) {
          const reviewId = String(review?.id || "");
          const decision = this.resolveDecisionForReview(review, this.reviewDecisions[reviewId] || {});

          if (decision.action === "reject") {
            const rejectResponse = await this.send("userImportReviewReject", {
              reviewId,
              reason: "admin-ui-review-table",
            });
            results.push({ reviewId, action: "reject", response: rejectResponse });
            continue;
          }

          const approvePayload = {
            reviewId,
            action: decision.action,
          };
          if (decision.userId) {
            approvePayload.userId = decision.userId;
          }

          const approveResponse = await this.send("userImportReviewApprove", approvePayload);
          results.push({ reviewId, action: decision.action, response: approveResponse });
        }

        await this.fetchReviewList();

        const hasErrors = results.some((entry) => !!entry?.response?.error);
        this.showResult("userImportReviewApplySelected", {
          totalProcessed: results.length,
          hasErrors,
          results,
        });
        this.setState({
          lastStatus: hasErrors ? "error" : "ok",
          lastUpdatedAt: nowIso(),
        });
      } catch (err) {
        this.showResult("userImportReviewApplySelected (client error)", {
          error: err && err.message ? err.message : String(err),
        });
        this.setState({
          lastStatus: "error",
          lastUpdatedAt: nowIso(),
        });
      } finally {
        this.setBusy(false);
      }
    }

    async runSyncPreview() {
      return this.runAction("userSyncPreview", "userSyncPreview", () => this.getScopePayload());
    }

    async runSyncApply() {
      return this.runAction("userSyncApply", "userSyncApply", () => {
        const payload = this.getScopePayload();
        payload.background = !!this.background.prop("checked");
        return payload;
      });
    }

    async runValidate() {
      return this.runAction("userValidate", "userValidate", () => {
        const payload = this.getScopePayload();
        payload.background = !!this.background.prop("checked");
        return payload;
      });
    }

    async runReconcilePreview() {
      return this.runAction("userReconcilePreview", "userReconcilePreview", () => {
        const payload = this.getScopePayload();
        payload.background = !!this.background.prop("checked");
        return payload;
      });
    }

    async runRestorePreview() {
      return this.runAction("userRestoreResync preview", "userRestoreResync", () => this.getScopePayload());
    }

    async runRestoreApply() {
      return this.runAction("userRestoreResync apply", "userRestoreResync", () => {
        const payload = this.getScopePayload();
        payload.apply = true;
        payload.background = !!this.background.prop("checked");
        return payload;
      });
    }

    async runJobList() {
      return this.runAction("userJobList", "userJobList", {});
    }
  }

  window.WiegandUserToolsPanel = UserToolsPanel;
})();
