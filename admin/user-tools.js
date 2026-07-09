/* eslint-disable no-undef */
/* eslint-disable no-console */

(function () {
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
    }

    init() {
      this.opsDataset = $("#ops_dataset");
      this.opsOutput = $("#ops_output");
      this.syncMode = $("#ops_sync_mode");
      this.background = $("#ops_background");
      this.userIds = $("#ops_user_ids");
      this.controllerIds = $("#ops_controller_ids");

      if (!this.opsDataset.val()) {
        this.opsDataset.val(pretty(this.datasetTemplate));
      }

      this.bindActions();
      if (M && M.updateTextFields) {
        M.updateTextFields();
      }
      if (this.syncMode.formSelect) {
        this.syncMode.formSelect();
      }
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
    }

    showResult(title, data) {
      this.opsOutput.val(`${title}\n${pretty(data)}`);
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

    async runUserList() {
      const response = await this.send("userList", {});
      this.showResult("userList", response);
    }

    async runImportPreview() {
      const response = await this.send("userImportPreview", {
        dataset: this.getDataset(),
      });
      this.showResult("userImportPreview", response);
    }

    async runImportApply() {
      const response = await this.send("userImportApply", {
        dataset: this.getDataset(),
        background: !!this.background.prop("checked"),
      });
      this.showResult("userImportApply", response);
    }

    async runReviewList() {
      const response = await this.send("userImportReviewList", {});
      this.showResult("userImportReviewList", response);
    }

    async runReviewApprovePending() {
      const reviewList = await this.send("userImportReviewList", {});
      const reviews = Array.isArray(reviewList?.reviews) ? reviewList.reviews : [];
      const pending = reviews.filter((item) => item.status === "pending");

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

      this.showResult("userImportReviewApprove (pending)", {
        totalPending: pending.length,
        approved,
      });
    }

    async runSyncPreview() {
      const response = await this.send("userSyncPreview", this.getScopePayload());
      this.showResult("userSyncPreview", response);
    }

    async runSyncApply() {
      const payload = this.getScopePayload();
      payload.background = !!this.background.prop("checked");
      const response = await this.send("userSyncApply", payload);
      this.showResult("userSyncApply", response);
    }

    async runValidate() {
      const payload = this.getScopePayload();
      payload.background = !!this.background.prop("checked");
      const response = await this.send("userValidate", payload);
      this.showResult("userValidate", response);
    }

    async runReconcilePreview() {
      const payload = this.getScopePayload();
      payload.background = !!this.background.prop("checked");
      const response = await this.send("userReconcilePreview", payload);
      this.showResult("userReconcilePreview", response);
    }

    async runRestorePreview() {
      const payload = this.getScopePayload();
      const response = await this.send("userRestoreResync", payload);
      this.showResult("userRestoreResync preview", response);
    }

    async runRestoreApply() {
      const payload = this.getScopePayload();
      payload.apply = true;
      payload.background = !!this.background.prop("checked");
      const response = await this.send("userRestoreResync", payload);
      this.showResult("userRestoreResync apply", response);
    }

    async runJobList() {
      const response = await this.send("userJobList", {});
      this.showResult("userJobList", response);
    }
  }

  window.WiegandUserToolsPanel = UserToolsPanel;
})();
