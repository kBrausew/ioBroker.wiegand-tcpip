/**
 * Presentation Layer
 * Handles all UI/messagebox communication and response building
 */

class Presentation {
  /**
   * @param {any} adapter ioBroker adapter instance
   * @param {any} application Application instance
   * @param {any} persist Persist instance
   */
  constructor(adapter, application, persist) {
    this.adapter = adapter;
    this.app = application;
    this.persist = persist;
  }

  /**
   * Main messagebox handler dispatcher
   * @param {object} obj ioBroker message object
   */
  async handle(obj) {
    if (typeof obj !== "object" || !obj.message) {
      return;
    }

    const command = obj.command || "";

    try {
      switch (command) {
        case "userList":
          return this.handleUserList(obj);
        case "userGet":
          return this.handleUserGet(obj);
        case "userUpsert":
          return this.handleUserUpsert(obj);
        case "userDelete":
          return this.handleUserDelete(obj);
        case "userImportPreview":
          return this.handleUserImportPreview(obj);
        case "userImportReviewList":
          return this.handleUserImportReviewList(obj);
        case "userImportReviewApprove":
          return this.handleUserImportReviewApprove(obj);
        case "userImportReviewReject":
          return this.handleUserImportReviewReject(obj);
        case "userImportApply":
          return this.handleUserImportApply(obj);
        case "userImportReviewClear":
          return this.handleUserImportReviewClear(obj);
        case "userValidate":
          return this.handleUserValidate(obj);
        case "userReconcilePreview":
          return this.handleUserReconcilePreview(obj);
        case "userSyncPreview":
          return this.handleUserSyncPreview(obj);
        case "userSyncApply":
          return this.handleUserSyncApply(obj);
        case "userRestoreResync":
          return this.handleUserRestoreResync(obj);
        case "userJobList":
          return this.handleUserJobList(obj);
        case "userJobGet":
          return this.handleUserJobGet(obj);
        // ========== CARD MANAGEMENT (V2.0) ==========
        case "cardList":
          return this.handleCardList(obj);
        case "cardGet":
          return this.handleCardGet(obj);
        case "cardUpsert":
          return this.handleCardUpsert(obj);
        case "cardDelete":
          return this.handleCardDelete(obj);
        case "cardPush":
          return this.handleCardPush(obj);
        case "cardSyncAll":
          return this.handleCardSyncAll(obj);
        // ========== MIGRATION (V2.0) ==========
        case "migrationReadControllers":
          return this.handleMigrationReadControllers(obj);
        case "migrationApply":
          return this.handleMigrationApply(obj);
        case "search":
          return this.handleSearch(obj);
        case "setip":
          return this.handleSetIP(obj);
        default:
          this.sendError(obj, `"${command.toUpperCase()}" is not a valid command`);
      }
    } catch (err) {
      this.adapter.log.error(`Presentation handler error (${command}): ${err.message}`);
      this.sendError(obj, err.message);
    }
  }

  // ========== USER MANAGEMENT ==========

  handleUserList(obj) {
    if (obj.callback) {
      this.adapter.sendTo(
        obj.from,
        obj.command,
        {
          error: false,
          users: Object.values(this.app.userDb.users),
        },
        obj.callback,
      );
    }
  }

  handleUserGet(obj) {
    if (obj.callback) {
      try {
        const userId = (obj.message.userId || obj.message.id || "").toString();
        const user = this.app.userDb.users[userId] || null;
        this.adapter.sendTo(
          obj.from,
          obj.command,
          { error: false, user },
          obj.callback,
        );
      } catch (err) {
        this.sendError(obj, err.message);
      }
    }
  }

  async handleUserUpsert(obj) {
    if (obj.callback) {
      try {
        const rawUser = obj.message.user || obj.message;
        const user = this.app.upsertUser(rawUser, "messagebox");
        await this.persist.persistUserDb(this.app.userDb, "userUpsert");
        this.adapter.sendTo(
          obj.from,
          obj.command,
          { error: false, user },
          obj.callback,
        );
      } catch (err) {
        this.sendError(obj, err.message);
      }
    }
  }

  async handleUserDelete(obj) {
    if (obj.callback) {
      try {
        const userId = (obj.message.userId || obj.message.id || "").toString();
        if (!userId) {
          throw new Error("Missing userId");
        }
        const existed = !!this.app.userDb.users[userId];
        if (existed) {
          delete this.app.userDb.users[userId];
          await this.persist.persistUserDb(this.app.userDb, "userDelete");
        }
        this.adapter.sendTo(
          obj.from,
          obj.command,
          { error: false, deleted: existed, userId },
          obj.callback,
        );
      } catch (err) {
        this.sendError(obj, err.message);
      }
    }
  }

  // ========== IMPORT ==========

  async handleUserImportPreview(obj) {
    if (obj.callback) {
      try {
        const dataset = obj.message.dataset || obj.message;
        const preview = this.app.buildImportPreview(dataset);
        this.app.userDb.reviewQueue = preview.reviewItems;
        await this.persist.persistUserDb(this.app.userDb, "importPreview");
        this.adapter.sendTo(
          obj.from,
          obj.command,
          { error: false, preview },
          obj.callback,
        );
      } catch (err) {
        this.sendError(obj, err.message);
      }
    }
  }

  handleUserImportReviewList(obj) {
    if (obj.callback) {
      try {
        const summary = this.persist.getReviewQueueSummary(this.app.userDb);
        this.adapter.sendTo(
          obj.from,
          obj.command,
          { error: false, summary, reviews: this.app.userDb.reviewQueue || [] },
          obj.callback,
        );
      } catch (err) {
        this.sendError(obj, err.message);
      }
    }
  }

  async handleUserImportReviewApprove(obj) {
    if (obj.callback) {
      try {
        const reviewId = (obj.message.reviewId || obj.message.id || "").toString();
        const action = (obj.message.action || "").toString();
        const userId = (obj.message.userId || "").toString();
        const review = this.app.approveReviewItem(reviewId, action, userId);
        await this.persist.persistUserDb(this.app.userDb, "reviewApprove");
        this.adapter.sendTo(
          obj.from,
          obj.command,
          {
            error: false,
            review,
            summary: this.persist.getReviewQueueSummary(this.app.userDb),
          },
          obj.callback,
        );
      } catch (err) {
        this.sendError(obj, err.message);
      }
    }
  }

  async handleUserImportReviewReject(obj) {
    if (obj.callback) {
      try {
        const reviewId = (obj.message.reviewId || obj.message.id || "").toString();
        const reason = (obj.message.reason || "").toString();
        const review = this.app.rejectReviewItem(reviewId, reason);
        await this.persist.persistUserDb(this.app.userDb, "reviewReject");
        this.adapter.sendTo(
          obj.from,
          obj.command,
          {
            error: false,
            review,
            summary: this.persist.getReviewQueueSummary(this.app.userDb),
          },
          obj.callback,
        );
      } catch (err) {
        this.sendError(obj, err.message);
      }
    }
  }

  async handleUserImportApply(obj) {
    if (obj.callback) {
      try {
        const dataset = obj.message.dataset || obj.message;
        const background = !!obj.message.background;

        if (background) {
          const job = this.app.startBackgroundJob("importApply", async () => {
            return await this.app.applyImportDataset(dataset);
          });
          this.adapter.sendTo(
            obj.from,
            obj.command,
            { error: false, accepted: true, jobId: job.id, job },
            obj.callback,
          );
          return;
        }

        const result = await this.app.applyImportDataset(dataset);
        this.adapter.sendTo(
          obj.from,
          obj.command,
          { error: false, result },
          obj.callback,
        );
      } catch (err) {
        this.sendError(obj, err.message);
      }
    }
  }

  async handleUserImportReviewClear(obj) {
    if (obj.callback) {
      try {
        const keepPending = obj.message.keepPending !== false;
        const cleared = this.app.clearReviewQueue({ keepPending });
        await this.persist.persistUserDb(this.app.userDb, "reviewClear");
        this.adapter.sendTo(
          obj.from,
          obj.command,
          {
            error: false,
            cleared,
            summary: this.persist.getReviewQueueSummary(this.app.userDb),
          },
          obj.callback,
        );
      } catch (err) {
        this.sendError(obj, err.message);
      }
    }
  }

  // ========== VALIDATION ==========

  async handleUserValidate(obj) {
    if (obj.callback) {
      try {
        const payload = obj.message || {};
        const background = !!obj.message.background;

        if (background) {
          const job = this.app.startBackgroundJob("validateUserDb", async () => {
            return await this.app.buildReconcilePreview(payload);
          });
          this.adapter.sendTo(
            obj.from,
            obj.command,
            { error: false, accepted: true, jobId: job.id, job },
            obj.callback,
          );
          return;
        }

        const report = await this.app.buildReconcilePreview(payload);
        this.adapter.sendTo(
          obj.from,
          obj.command,
          { error: false, report },
          obj.callback,
        );
      } catch (err) {
        this.sendError(obj, err.message);
      }
    }
  }

  async handleUserReconcilePreview(obj) {
    if (obj.callback) {
      try {
        const payload = obj.message || {};
        const background = !!obj.message.background;

        if (background) {
          const job = this.app.startBackgroundJob("reconcilePreview", async () => {
            return await this.app.buildReconcilePreview(payload);
          });
          this.adapter.sendTo(
            obj.from,
            obj.command,
            { error: false, accepted: true, jobId: job.id, job },
            obj.callback,
          );
          return;
        }

        const report = await this.app.buildReconcilePreview(payload);
        this.adapter.sendTo(
          obj.from,
          obj.command,
          { error: false, report },
          obj.callback,
        );
      } catch (err) {
        this.sendError(obj, err.message);
      }
    }
  }

  // ========== SYNC ==========

  async handleUserSyncPreview(obj) {
    if (obj.callback) {
      try {
        const payload = obj.message || {};
        const preview = this.app.buildSyncPlan(payload);
        await this.adapter.setStateAsync("cards.lastSyncPreview", {
          ack: true,
          val: JSON.stringify(preview),
        });
        this.adapter.sendTo(
          obj.from,
          obj.command,
          { error: false, preview },
          obj.callback,
        );
      } catch (err) {
        this.sendError(obj, err.message);
      }
    }
  }

  async handleUserSyncApply(obj) {
    if (obj.callback) {
      try {
        const payload = obj.message || {};
        const background = !!obj.message.background;

        if (background) {
          const job = this.app.startBackgroundJob("syncApply", async () => {
            return await this.app.applySyncPlan(payload);
          });
          this.adapter.sendTo(
            obj.from,
            obj.command,
            { error: false, accepted: true, jobId: job.id, job },
            obj.callback,
          );
          return;
        }

        const result = await this.app.applySyncPlan(payload);
        this.adapter.sendTo(
          obj.from,
          obj.command,
          { error: false, result },
          obj.callback,
        );
      } catch (err) {
        this.sendError(obj, err.message);
      }
    }
  }

  // ========== RESTORE/RESYNC ==========

  async handleUserRestoreResync(obj) {
    if (obj.callback) {
      try {
        const payload = obj.message || {};
        const apply = !!obj.message.apply;
        const background = !!obj.message.background;

        if (!apply) {
          const preview = await this.app.buildRestoreResyncPlan(payload);
          this.adapter.sendTo(
            obj.from,
            obj.command,
            { error: false, preview },
            obj.callback,
          );
          return;
        }

        if (background) {
          const job = this.app.startBackgroundJob("restoreResyncApply", async () => {
            return await this.app.applyRestoreResync(payload);
          });
          this.adapter.sendTo(
            obj.from,
            obj.command,
            { error: false, accepted: true, jobId: job.id, job },
            obj.callback,
          );
          return;
        }

        const result = await this.app.applyRestoreResync(payload);
        this.adapter.sendTo(
          obj.from,
          obj.command,
          { error: false, result },
          obj.callback,
        );
      } catch (err) {
        this.sendError(obj, err.message);
      }
    }
  }

  // ========== JOBS ==========

  handleUserJobList(obj) {
    if (obj.callback) {
      try {
        this.adapter.sendTo(
          obj.from,
          obj.command,
          { error: false, jobs: this.app.getJobs() },
          obj.callback,
        );
      } catch (err) {
        this.sendError(obj, err.message);
      }
    }
  }

  handleUserJobGet(obj) {
    if (obj.callback) {
      try {
        const jobId = (obj.message.jobId || obj.message.id || "").toString();
        const job = this.app.jobs[jobId] || null;
        this.adapter.sendTo(
          obj.from,
          obj.command,
          { error: false, job },
          obj.callback,
        );
      } catch (err) {
        this.sendError(obj, err.message);
      }
    }
  }

  // ========== DEVICE MANAGEMENT ==========

  handleSearch(obj) {
    if (obj.callback) {
      this.app.wrapperAPI
        .getDevices(this.app.createSearchConfig())
        .then((uRet) => {
          this.adapter.sendTo(obj.from, obj.command, uRet, obj.callback);
          this.adapter.log.debug(`Search found: ${JSON.stringify(uRet)}`);
        })
        .catch((err) => {
          this.sendError(obj, err.message);
          this.adapter.log.error(`Search error: ${err.message}`);
        });
    }
  }

  handleSetIP(obj) {
    if (obj.callback) {
      this.adapter.log.silly(JSON.stringify(obj.message));
      this.app.wrapperAPI
        .setIP(
          this.app.createSearchConfig(),
          obj.message.deviceId,
          obj.message.address,
          obj.message.netmask,
          obj.message.gateway,
        )
        .then((uRet) => {
          this.adapter.sendTo(obj.from, obj.command, uRet, obj.callback);
          this.adapter.log.info(JSON.stringify(uRet));
        })
        .catch((err) => {
          this.sendError(obj, err.message);
          this.adapter.log.error(`SetIP error: ${err.message}`);
        });
    }
  }

  // ========== CARD MANAGEMENT (V2.0 Card-centric) ==========

  handleCardList(obj) {
    if (obj.callback) {
      try {
        const cards = Object.values(this.app.cardDb.cards || {});
        this.adapter.sendTo(
          obj.from,
          obj.command,
          { error: false, cards },
          obj.callback,
        );
      } catch (err) {
        this.sendError(obj, err.message);
      }
    }
  }

  handleCardGet(obj) {
    if (obj.callback) {
      try {
        const cardNumber = (obj.message.cardNumber || obj.message.id || "").toString();
        const card = this.app.cardDb.cards?.[cardNumber] || null;
        this.adapter.sendTo(
          obj.from,
          obj.command,
          { error: false, card },
          obj.callback,
        );
      } catch (err) {
        this.sendError(obj, err.message);
      }
    }
  }

  async handleCardUpsert(obj) {
    if (obj.callback) {
      try {
        const rawCard = obj.message.card || obj.message;
        const card = this.app.upsertCard(rawCard, "messagebox");
        await this.persist.persistCardDb(this.app.cardDb, "cardUpsert");
        this.adapter.sendTo(
          obj.from,
          obj.command,
          { error: false, card },
          obj.callback,
        );
      } catch (err) {
        this.sendError(obj, err.message);
      }
    }
  }

  async handleCardDelete(obj) {
    if (obj.callback) {
      try {
        const cardNumber = (obj.message.cardNumber || obj.message.id || "").toString();
        if (!cardNumber) {
          throw new Error("Missing cardNumber");
        }
        const existed = !!this.app.cardDb.cards?.[cardNumber];
        if (existed) {
          delete this.app.cardDb.cards[cardNumber];
          await this.persist.persistCardDb(this.app.cardDb, "cardDelete");
        }
        this.adapter.sendTo(
          obj.from,
          obj.command,
          { error: false, deleted: existed, cardNumber },
          obj.callback,
        );
      } catch (err) {
        this.sendError(obj, err.message);
      }
    }
  }

  async handleCardPush(obj) {
    if (obj.callback) {
      try {
        const cardNumber = (obj.message.cardNumber || "").toString();
        if (!cardNumber) throw new Error("Missing cardNumber");
        const card = this.app.cardDb.cards?.[cardNumber];
        if (!card) throw new Error(`Card ${cardNumber} not found in database`);
        const result = await this.app.pushCardToControllers(card);
        this.adapter.sendTo(obj.from, obj.command, { error: false, ...result }, obj.callback);
      } catch (err) {
        this.sendError(obj, err.message);
      }
    }
  }

  async handleCardSyncAll(obj) {
    if (obj.callback) {
      try {
        const result = await this.app.syncAllCardsToControllers();
        this.adapter.sendTo(obj.from, obj.command, { error: false, ...result }, obj.callback);
      } catch (err) {
        this.sendError(obj, err.message);
      }
    }
  }

  // ========== MIGRATION (V2.0) ==========

  async handleMigrationReadControllers(obj) {
    if (obj.callback) {
      try {
        const controllerIds = (obj.message.controllerIds || []).map((id) => parseInt(id, 10)).filter((id) => !isNaN(id));
        const readAll = obj.message.readAll === true;

        const cardsFromControllers = await this.app.readCardsFromControllers(
          readAll ? undefined : controllerIds,
        );

        this.adapter.sendTo(
          obj.from,
          obj.command,
          { error: false, cardsFromControllers },
          obj.callback,
        );
      } catch (err) {
        this.sendError(obj, err.message);
      }
    }
  }

  async handleMigrationApply(obj) {
    if (obj.callback) {
      try {
        const cardsFromControllers = obj.message.cardsFromControllers || [];
        const mode = (obj.message.mode || "overwrite").toString(); // overwrite | append

        const result = await this.app.applyMigration(cardsFromControllers, mode);
        await this.persist.persistCardDb(this.app.cardDb, "migrationApply");

        this.adapter.sendTo(
          obj.from,
          obj.command,
          { error: false, result },
          obj.callback,
        );
      } catch (err) {
        this.sendError(obj, err.message);
      }
    }
  }

  // ========== HELPERS ==========

  sendError(obj, message) {
    if (obj.callback) {
      this.adapter.sendTo(
        obj.from,
        obj.command,
        { error: true, err: { message } },
        obj.callback,
      );
    }
  }
}

module.exports = Presentation;
