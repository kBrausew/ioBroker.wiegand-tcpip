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
    }

    async initialize() {
      this.attachEventListeners();
      await this.refreshCardTable();
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
      for (const card of this.cards) {
        if (card.controllerAccess && typeof card.controllerAccess === "object") {
          for (const ctrlId of Object.keys(card.controllerAccess)) {
            controllers.add(parseInt(ctrlId, 10));
          }
        }
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
      $("#card_form_number").val(card.cardNumber);
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
          M.toast({ html: t("op-ok") });
          self.refreshCardTable();
          self.clearForm();
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

    clearForm() {
      this.selectedCard = null;
      $("#card_form_number").val("");
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
      this.phase1Completed = false;
      this.phase2Data = [];
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
        $("#migration_controller_ids").prop("disabled", true);
      });

      $("#migration_read_mode_selected").on("change", () => {
        $("#migration_controller_ids").prop("disabled", false);
      });

      // Default: select all
      $("#migration_read_mode_all").prop("checked", true).trigger("change");

      $("#migration_read_apply").click(() => {
        self.readControllers();
      });

      $("#migration_phase1_confirm").click(() => {
        self.confirmPhase1();
      });

      $("#migration_phase1_cancel").click(() => {
        self.cancelMigration();
      });

      $("#migration_phase2_assign_all").click(() => {
        self.assignAllPhase2();
      });

      $("#migration_phase2_done").click(() => {
        self.finalizeMigration();
      });
    }

    readControllers() {
      const self = this;
      const readAll = $("#migration_read_mode_all").is(":checked");
      const controllerIds = readAll ? [] : parseCsvNumbers($("#migration_controller_ids").val());

      sendTo(null, "migrationReadControllers", { readAll, controllerIds }, function (result) {
        if (result && !result.error) {
          self.cardsFromControllers = result.cardsFromControllers || [];
          self.phase1Completed = false;
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
          $("<td>").text(t("migration_phase1_status") + ": Ready")
        );
        $tbody.append($row);
      }
    }

    confirmPhase1() {
      const self = this;

      sendTo(null, "migrationApply", { cardsFromControllers: this.cardsFromControllers, mode: "overwrite" }, function (result) {
        if (result && !result.error) {
          self.phase1Completed = true;
          const importedCount = result.result.imported || 0;
          const updatedCount = result.result.updated || 0;
          M.toast({ html: `Imported: ${importedCount}, Updated: ${updatedCount}` });
          self.preparePhase2();
        } else {
          const msg = result?.err?.message || t("unknow-message");
          M.toast({ html: msg });
        }
      });
    }

    preparePhase2() {
      // Phase 2 shows the imported cards for username assignment
      this.phase2Data = this.cardsFromControllers.map((card) => ({
        cardNumber: card.cardNumber,
        username: "",
        assigned: false,
      }));
      this.renderPhase2Table();
    }

    renderPhase2Table() {
      const $tbody = $("#migration_phase2_body");
      $tbody.empty();

      for (const item of this.phase2Data) {
        const $row = $("<tr>").append(
          $("<td>").text(item.cardNumber),
          $("<td>").append(
            $("<input>")
              .attr("type", "text")
              .data("card-number", item.cardNumber)
              .val(item.username)
              .on("change", (e) => {
                item.username = $(e.target).val();
              })
              .addClass("form-control")
              .css("width", "100%")
          ),
          $("<td>").text(item.assigned ? "✓" : "-")
        );
        $tbody.append($row);
      }
    }

    assignAllPhase2() {
      const self = this;

      // Collect all username assignments
      for (const item of this.phase2Data) {
        const $input = $(`input[data-card-number="${item.cardNumber}"]`);
        item.username = $input.val() || "";
        if (item.username.length > 0) {
          item.assigned = true;
        }
      }

      // Update cards with usernames (async)
      let completed = 0;
      for (const item of this.phase2Data) {
        if (item.assigned) {
          sendTo(null, "cardUpsert", { card: { cardNumber: item.cardNumber, username: item.username } }, function (result) {
            completed++;
            if (completed === self.phase2Data.filter((i) => i.assigned).length) {
              M.toast({ html: "Username assignments completed" });
            }
          });
        }
      }

      this.renderPhase2Table();
    }

    finalizeMigration() {
      M.toast({ html: "Migration complete" });
      this.cancelMigration();
    }

    cancelMigration() {
      this.cardsFromControllers = [];
      this.phase1Completed = false;
      this.phase2Data = [];
      $("#migration_phase1_body").empty();
      $("#migration_phase2_body").empty();
      $("#migration_diff_body").empty();
    }
  }

  // ================= WINDOW EXPORTS =================

  window.CardPanel = CardPanel;
  window.MigrationPanel = MigrationPanel;
})();
