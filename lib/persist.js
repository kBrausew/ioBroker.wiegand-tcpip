/**
 * Persistence Layer
 * Handles all state persistence for user database and background jobs
 */

class Persist {
  /**
   * @param {any} adapter ioBroker adapter instance
   */
  constructor(adapter) {
    this.adapter = adapter;
  }

  /**
   * Save user database to state
   * @param {object} userDb User database object
   * @param {string} source Operation source for audit trail
   */
  async persistUserDb(userDb, source) {
    userDb.updatedAt = new Date().toISOString();
    userDb.lastSource = source || "unknown";

    await this.adapter.setStateAsync("cards.db", {
      ack: true,
      val: JSON.stringify(userDb),
    });
    await this.adapter.setStateAsync("cards.userCount", {
      ack: true,
      val: Object.keys(userDb.users).length,
    });
    await this.adapter.setStateAsync("cards.credentialCount", {
      ack: true,
      val: this.countCredentials(userDb),
    });
    await this.adapter.setStateAsync("cards.lastUpdate", {
      ack: true,
      val: userDb.updatedAt,
    });
    await this.adapter.setStateAsync("cards.reviewQueue", {
      ack: true,
      val: JSON.stringify(userDb.reviewQueue || []),
    });
    await this.adapter.setStateAsync("cards.reviewPending", {
      ack: true,
      val: this.getReviewQueueSummary(userDb).pending,
    });
  }

  /**
   * Save job queue to state
   * @param {array} jobs Jobs array
   */
  async persistJobsState(jobs) {
    await this.adapter.setStateAsync("cards.jobs", {
      ack: true,
      val: JSON.stringify(jobs),
    });
    await this.adapter.setStateAsync("cards.lastJob", {
      ack: true,
      val: jobs.length > 0 ? JSON.stringify(jobs[0]) : "{}",
    });
  }

  /**
   * Load user database from state
   * @returns {Promise<object>} User database object
   */
  async loadUserDatabase() {
    const dbState = await this.adapter.getStateAsync("cards.db");
    if (dbState && typeof dbState.val === "string" && dbState.val.trim()) {
      try {
        const parsed = JSON.parse(dbState.val);
        if (parsed && typeof parsed === "object" && parsed.users) {
          return parsed;
        }
      } catch (err) {
        this.adapter.log.warn(`Could not parse cards.db. Resetting DB: ${err.message}`);
      }
    }

    return this.createEmptyUserDb();
  }

  /**
   * Create empty user database structure
   * @returns {object} Empty user database
   */
  createEmptyUserDb() {
    return {
      schemaVersion: 1,
      updatedAt: "",
      reviewQueue: [],
      users: {},
    };
  }

  /**
   * Count total credentials in database
   * @param {object} userDb User database
   * @returns {number} Credential count
   */
  countCredentials(userDb) {
    return Object.values(userDb.users).reduce((sum, user) => {
      return (
        sum + (Array.isArray(user.credentials) ? user.credentials.length : 0)
      );
    }, 0);
  }

  /**
   * Get review queue summary statistics
   * @param {object} userDb User database
   * @returns {object} Summary stats
   */
  getReviewQueueSummary(userDb) {
    const queue = Array.isArray(userDb.reviewQueue) ? userDb.reviewQueue : [];
    let pending = 0;
    let approved = 0;
    let rejected = 0;
    let applied = 0;
    let failed = 0;

    for (const item of queue) {
      if (item.status === "pending") {
        pending += 1;
      } else if (item.status === "approved") {
        approved += 1;
      } else if (item.status === "rejected") {
        rejected += 1;
      } else if (item.status === "applied") {
        applied += 1;
      } else if (item.status === "failed") {
        failed += 1;
      }
    }

    return {
      total: queue.length,
      pending,
      approved,
      rejected,
      applied,
      failed,
    };
  }
}

module.exports = Persist;
