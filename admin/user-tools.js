/* eslint-disable no-undef */
/* eslint-disable no-console */

(function () {
  // ================= GLOBAL FUNCTION EXPORTS =================
  // Make sendTo available in global scope for MessageBox IPC
  if (typeof window !== 'undefined' && typeof window.sendTo === 'undefined') {
    window.sendTo = (typeof sendTo !== 'undefined') ? sendTo : function() {
      console.warn("sendTo not available - ioBroker Admin framework not loaded");
    };
  }

  // ================= HELPER FUNCTIONS =================

  function parseCsvNumbers(rawValue) {
    if (!rawValue || typeof rawValue !== "string") {
      return [];
    }
    return rawValue
      .split(",")
      .map((item) => parseInt(item.trim(), 10))
      .filter((item) => !isNaN(item));
  }

  function pretty(data) {
    try {
      return JSON.stringify(data, null, 2);
    } catch (_err) {
      return String(data);
    }
  }

  function t(key) {
    try {
      if (typeof _ === "function") {
        return _(key);
      }
    } catch (_err) {
      // Ignore translation lookup errors and fall back to key.
    }
    return key;
  }

  // ================= CARD MANAGEMENT PANEL =================

  class CardPanel {
    constructor() {
      this.cards = [];
      this.selectedCard = null;
      this.filterText = "";
      this.filterController = "";
      this.unsyncedCount = 0;
    }

    async initialize() {
      this.attachEventListeners();
      this.attachBeforeUnload();
      await this.refreshCardTable();
    }

    attachBeforeUnload() {
      window.addEventListener("beforeunload", (e) => {
        if (this.unsyncedCount > 0) {
          e.preventDefault();
          e.returnValue = "";
        }
      });
    }

    markUnsynced(delta) {
      this.unsyncedCount = Math.max(0, this.unsyncedCount + delta);
      const $badge = $("#card_unsync_badge");
      if (this.unsyncedCount > 0) {
        $badge.text(`⚠ ${this.unsyncedCount} ${t("card_unsync_hint")}`).show();
      } else {
        $badge.hide();
      }
    }

    attachEventListeners() {
      const self = this;

      $("#card_filter_text").on("keyup", () => {
        self.filterText = $("#card_filter_text").val() || "";
        self.applyCardFilter();
      });

      $("#card_filter_controller").on("change", () => {
        self.filterController = $("#card_filter_controller").val() || "";
        self.applyCardFilter();
      });

      $("#card_refresh_table").click(() => {
        self.refreshCardTable();
      });

      $("#card_action_new").click(() => {
        self.newCard();
      });

      $("#card_sync_all").click(() => {
        self.syncAllCards();
      });

      $(document).on("click", ".card-table-row", function () {
        const cardNumber = $(this).data("card-number");
        self.editCard(cardNumber);
      });

      $(document).on("click", ".card-delete-btn", function (e) {
        e.stopPropagation();
        const cardNumber = $(this).data("card-number");
        self.deleteCard(cardNumber);
      });

      $("#card_action_save").click(() => {
        self.saveCard();
      });

      $("#card_action_delete").click(() => {
        if (self.selectedCard) {
          self.deleteCard(self.selectedCard.cardNumber);
        }
      });

      $("#card_action_cancel").click(() => {
        self.clearForm();
      });
    }

    async refreshCardTable() {
      const self = this;
      sendTo(null, "cardList", {}, function (result) {
        if (result && !result.error) {
          self.cards = result.cards || [];
          self.populateControllerFilter();
          self.renderCardTable();
          self.applyCardFilter();
          M.toast({ html: t("op-ok") });
        } else {
          const msg = result?.err?.message || t("unknow-message");
          M.toast({ html: msg });
        }
      });
    }

    populateControllerFilter() {
      const controllers = new Set();
      // From loaded cards
      for (const card of this.cards) {
        if (card.controllerAccess && typeof card.controllerAccess === "object") {
          for (const ctrlId of Object.keys(card.controllerAccess)) {
            controllers.add(parseInt(ctrlId, 10));
          }
        }
      }
      // From configured controllers (window.controllers set by index_m.js)
      for (const ctrl of (window.controllers || [])) {
        if (ctrl.serial) controllers.add(parseInt(ctrl.serial, 10));
      }

      const $select = $("#card_filter_controller");
      $select.empty();
      $select.append($("<option>").val("").text(t("card_filter_all_controllers")));
      for (const ctrlId of Array.from(controllers).sort((a, b) => a - b)) {
        $select.append($("<option>").val(ctrlId).text(`Controller ${ctrlId}`));
      }
      if ($select.hasClass("initialized")) {
        M.FormSelect.getInstance($select[0])?.destroy();
      }
      M.FormSelect.init($select[0], {});
    }

    renderCardTable() {
      const $tbody = $("#card_table_body");
      $tbody.empty();

      for (const card of this.cards) {
        const controllers = Object.keys(card.controllerAccess || {})
          .map((c) => parseInt(c, 10))
          .sort((a, b) => a - b)
          .join(", ");

        const $row = $("<tr>")
          .addClass("card-table-row")
          .css("cursor", "pointer")
          .data("card-number", card.cardNumber)
          .append(
            $("<td>").text(card.cardNumber),
            $("<td>").text(card.username || "-"),
            $("<td>").text(card.pin || "-"),
            $("<td>").text(controllers || "-"),
            $("<td>").append(
              $("<a>")
                .addClass("btn waves-effect waves-light btn-small red darken-1 card-delete-btn")
                .data("card-number", card.cardNumber)
                .html('<i class="material-icons left">delete</i>' + t("card_action_delete"))
            )
          );
        $tbody.append($row);
      }
    }

    applyCardFilter() {
      const textLower = this.filterText.toLowerCase();
      const $rows = $(".card-table-row");

      $rows.each((idx, row) => {
        const $row = $(row);
        const cardNumber = $row.data("card-number").toString();
        const card = this.cards.find((c) => c.cardNumber.toString() === cardNumber);

        if (!card) {
          $row.hide();
          return;
        }

        let matches = true;

        // Filter by text (username or card number)
        if (textLower.length > 0) {
          const userName = (card.username || "").toLowerCase();
          const cardNum = cardNumber.toLowerCase();
          matches = userName.includes(textLower) || cardNum.includes(textLower);
        }

        // Filter by controller
        if (matches && this.filterController) {
          const ctrlId = parseInt(this.filterController, 10);
          matches = card.controllerAccess && card.controllerAccess[ctrlId];
        }

        $row.toggle(matches);
      });
    }

    editCard(cardNumber) {
      const card = this.cards.find((c) => c.cardNumber.toString() === cardNumber.toString());
      if (!card) return;

      this.selectedCard = card;
      $("#card_form_number").val(card.cardNumber).prop("readonly", true);
      $("#card_form_username").val(card.username || "");
      $("#card_form_pin").val(card.pin || "");
      $("#card_form_status").val(card.status || "active");

      this.renderControllerCheckboxes(card);
    }

    renderControllerCheckboxes(card) {
      const $container = $("#card_form_controller_checkboxes");
      $container.empty();

      // Build list of all configured controllers from settings (1:n support)
      // window.controllers set by index_m.js load() from settings.controllers
      const configuredControllers = (window.controllers || []).map((c) => ({
        serial: c.serial ? c.serial.toString() : null,
        maxDoors: parseInt(c.modelType, 10) || 4,
      })).filter((c) => c.serial);

      // Merge: configured controllers + any extra in card.controllerAccess (legacy)
      const cardAccess = card.controllerAccess || {};
      const extraCtrlIds = Object.keys(cardAccess).filter(
        (id) => !configuredControllers.find((c) => c.serial === id)
      );
      const allControllers = [
        ...configuredControllers,
        ...extraCtrlIds.map((id) => ({ serial: id, maxDoors: 4, legacy: true })),
      ];

      if (allControllers.length === 0) {
        $container.append(
          $("<div>").addClass("col s12 grey-text").text(t("card_form_no_controllers"))
        );
        return;
      }

      const $row = $("<div>").addClass("row");
      for (const ctrl of allControllers) {
        const ctrlId = ctrl.serial;
        const checkedDoors = cardAccess[ctrlId] || [];
        const $div = $("<div>").addClass("col s12 m6 l4").css("margin-bottom", "8px");

        const titleText = ctrl.legacy
          ? `Controller ${ctrlId} ⚠`
          : `Controller ${ctrlId}`;
        $div.append($("<strong>").text(titleText));

        for (let door = 1; door <= ctrl.maxDoors; door++) {
          const checked = checkedDoors.includes(door);
          const $label = $("<label>").css("display", "block").append(
            $("<input>")
              .attr("type", "checkbox")
              .attr("data-ctrl", ctrlId)
              .attr("data-door", door)
              .prop("checked", checked)
              .addClass("card-door-checkbox"),
            $("<span>").text(` ${t("door_label")} ${door}`)
          );
          $div.append($label);
        }
        $row.append($div);
      }
      $container.append($row);
    }

    saveCard() {
      const self = this;
      const cardNumber = $("#card_form_number").val();
      if (!cardNumber) {
        M.toast({ html: "Card number is required" });
        return;
      }

      const controllerAccess = {};
      $(".card-door-checkbox:checked").each(function () {
        const ctrl = $(this).data("ctrl").toString();
        const door = parseInt($(this).data("door"), 10);
        if (!controllerAccess[ctrl]) {
          controllerAccess[ctrl] = [];
        }
        controllerAccess[ctrl].push(door);
      });

      const card = {
        cardNumber: cardNumber,
        username: $("#card_form_username").val() || null,
        pin: $("#card_form_pin").val() || null,
        controllerAccess: controllerAccess,
      };

      sendTo(null, "cardUpsert", { card }, function (result) {
        if (result && !result.error) {
          // Auto-push to controllers
          sendTo(null, "cardPush", { cardNumber: cardNumber }, function (pushResult) {
            if (pushResult && !pushResult.error) {
              const pushed = pushResult.pushed || 0;
              const failed = pushResult.failed || 0;
              if (failed > 0) {
                M.toast({ html: t("card_push_partial").replace("{pushed}", pushed).replace("{failed}", failed) });
                self.markUnsynced(1);
              } else if (pushed > 0) {
                M.toast({ html: t("card_push_ok").replace("{pushed}", pushed) });
                self.markUnsynced(-1);
              } else {
                // No controllers with access defined — saved in DB only
                M.toast({ html: t("card_push_none") });
                self.markUnsynced(1);
              }
            } else {
              M.toast({ html: t("card_push_failed") });
              self.markUnsynced(1);
            }
          });
          self.refreshCardTable();
          self.clearForm();
        } else {
          const msg = result?.err?.message || t("unknow-message");
          M.toast({ html: msg });
        }
      });
    }

    syncAllCards() {
      const self = this;
      M.toast({ html: t("card_sync_all_running") });
      sendTo(null, "cardSyncAll", {}, function (result) {
        if (result && !result.error) {
          const msg = t("card_sync_all_ok")
            .replace("{cardCount}", result.cardCount || 0)
            .replace("{pushed}", result.pushed || 0)
            .replace("{failed}", result.failed || 0);
          M.toast({ html: msg });
          if ((result.failed || 0) === 0) {
            self.unsyncedCount = 0;
            $("#card_unsync_badge").hide();
          }
        } else {
          const msg = result?.err?.message || t("unknow-message");
          M.toast({ html: msg });
        }
      });
    }

    deleteCard(cardNumber) {
      const self = this;
      if (confirm(`Delete card ${cardNumber}?`)) {
        sendTo(null, "cardDelete", { cardNumber }, function (result) {
          if (result && !result.error) {
            M.toast({ html: t("op-ok") });
            self.refreshCardTable();
            self.clearForm();
          } else {
            const msg = result?.err?.message || t("unknow-message");
            M.toast({ html: msg });
          }
        });
      }
    }

    newCard() {
      this.selectedCard = null;
      $("#card_form_number").val("").prop("readonly", false);
      $("#card_form_username").val("");
      $("#card_form_pin").val("");
      $("#card_form_status").val("active");
      this.renderControllerCheckboxes({ controllerAccess: {} });
      $("#card_form_number").focus();
    }

    clearForm() {
      this.selectedCard = null;
      $("#card_form_number").val("").prop("readonly", true);
      $("#card_form_username").val("");
      $("#card_form_pin").val("");
      $("#card_form_status").val("active");
      $("#card_form_controller_checkboxes").empty();
    }
  }

  // ================= MIGRATION PANEL =================

  class MigrationPanel {
    constructor() {
      this.cardsFromControllers = [];
    }

    async initialize() {
      this.attachEventListeners();
      // Initialize Materialize tabs
      setTimeout(() => {
        M.Tabs.init(document.querySelector(".tabs"), {});
      }, 100);
    }

    attachEventListeners() {
      const self = this;

      $("#migration_read_mode_all").on("change", () => {
        $("#migration_controller_checkboxes_wrap").hide();
      });

      $("#migration_read_mode_selected").on("change", () => {
        $("#migration_controller_checkboxes_wrap").show();
      });

      // Default: select all
      $("#migration_read_mode_all").prop("checked", true).trigger("change");
      this.populateMigrationControllerCheckboxes();

      $("#migration_read_apply").click(() => {
        self.readControllers();
      });

      $("#migration_phase1_confirm").click(() => {
        self.applyMigrationOneStep();
      });

      $("#migration_phase1_cancel").click(() => {
        self.cancelMigration();
      });
    }

    populateMigrationControllerCheckboxes() {
      const $container = $("#migration_controller_checkboxes");
      $container.empty();
      const configuredControllers = (window.controllers || []).filter((c) => c.serial);
      if (configuredControllers.length === 0) {
        $container.append($("<span>").addClass("grey-text").text(t("card_form_no_controllers")));
        return;
      }
      for (const ctrl of configuredControllers) {
        const ctrlId = ctrl.serial.toString();
        const $label = $("<label>").css("display", "block").css("margin-bottom", "4px").append(
          $("<input>")
            .attr("type", "checkbox")
            .attr("data-ctrl", ctrlId)
            .addClass("migration-ctrl-checkbox"),
          $("<span>").text(` Controller ${ctrlId}`)
        );
        $container.append($label);
      }
    }

    readControllers() {
      const self = this;
      const readAll = $("#migration_read_mode_all").is(":checked");
      const controllerIds = readAll ? [] : $(".migration-ctrl-checkbox:checked").map(function() { return parseInt($(this).data("ctrl"), 10); }).get();

      sendTo(null, "migrationReadControllers", { readAll, controllerIds }, function (result) {
        if (result && !result.error) {
          self.cardsFromControllers = result.cardsFromControllers || [];
          self.renderPhase1Table();
          M.toast({ html: `Found ${self.cardsFromControllers.length} cards` });
        } else {
          const msg = result?.err?.message || t("unknow-message");
          M.toast({ html: msg });
        }
      });
    }

    renderPhase1Table() {
      const $tbody = $("#migration_phase1_body");
      $tbody.empty();

      for (const card of this.cardsFromControllers) {
        const $row = $("<tr>").append(
          $("<td>").text(card.cardNumber),
          $("<td>").text((card.controllers || []).join(", ")),
          $("<td>").append(
            $("<input>")
              .attr("type", "text")
              .attr("data-migration-username", card.cardNumber)
              .val(card.username || "")
              .css("margin", "0")
              .css("height", "2rem")
              .css("font-size", "13px")
              .attr("placeholder", "username")
          ),
          $("<td>").text(t("migration_phase1_status") + ": Ready")
        );
        $tbody.append($row);
      }
    }

    applyMigrationOneStep() {
      const self = this;

      const cardsForApply = (this.cardsFromControllers || []).map((card) => {
        const username = String($(`input[data-migration-username="${card.cardNumber}"]`).val() || "").trim();
        return {
          ...card,
          username: username || null,
        };
      });

      sendTo(null, "migrationApply", { cardsFromControllers: cardsForApply, mode: "overwrite" }, function (result) {
        if (result && !result.error) {
          const importedCount = result.result.imported || 0;
          const updatedCount = result.result.updated || 0;
          const removedCount = result.result.removed || 0;
          M.toast({ html: `Imported: ${importedCount}, Updated: ${updatedCount}, Removed: ${removedCount}` });
          self.cardsFromControllers = cardsForApply;
          self.cancelMigration();
        } else {
          const msg = result?.err?.message || t("unknow-message");
          M.toast({ html: msg });
        }
      });
    }

    cancelMigration() {
      this.cardsFromControllers = [];
      $("#migration_phase1_body").empty();
      $("#migration_diff_body").empty();
    }
  }

  // ================= WINDOW EXPORTS =================

  window.CardPanel = CardPanel;
  window.MigrationPanel = MigrationPanel;
})();
