const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");
const axios = require("axios");
const { tests } = require("@iobroker/testing");

const ADAPTER_ROOT = path.join(__dirname, "..");
const SIMULATOR_EXE = path.join(
  ADAPTER_ROOT,
  ".tools",
  "uhppote-simulator",
  "uhppote-simulator.exe",
);
const SIMULATOR_DEVICES_DIR = path.join(
  ADAPTER_ROOT,
  ".tools",
  "uhppote-simulator",
  "devices",
);
const SIMULATOR_BIND_PORT = 60000;
const SIMULATOR_REST_PORT = 18000;
const SIMULATOR_REST = `http://127.0.0.1:${SIMULATOR_REST_PORT}`;
const CONTROLLER_ID = 405419896;
const CONTROLLER_ID_2 = 405419897;
const AUTH_CARD = 10058400;
const DENIED_CARD = 10059999;
const MERGE_CARD = 10051111;

/** @type {import("node:child_process").ChildProcessWithoutNullStreams | undefined} */
let simulatorProcess;

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function sendToAsync(harness, command, message) {
  return new Promise((resolve) => {
    harness.sendTo("wiegand-tcpip.0", command, message, (response) => {
      resolve(response);
    });
  });
}

async function waitForJobStatus(harness, jobId, allowedStatuses, timeoutMs = 20000, pollMs = 200) {
  const started = Date.now();
  const accepted = new Set(allowedStatuses);

  while (Date.now() - started < timeoutMs) {
    const response = await sendToAsync(harness, "userJobGet", { jobId });
    const status = response?.job?.status;
    if (status && accepted.has(status)) {
      return response.job;
    }
    await wait(pollMs);
  }

  throw new Error(`Timed out waiting for job ${jobId} status: ${JSON.stringify([...accepted])}`);
}

async function waitForSimulatorReady(timeoutMs = 15000) {
  const started = Date.now();

  while (Date.now() - started < timeoutMs) {
    try {
      await axios.get(`${SIMULATOR_REST}/uhppote/simulator`, { timeout: 1000 });
      return;
    } catch {
      await wait(250);
    }
  }

  throw new Error("UHPPOTE simulator REST endpoint did not become ready in time.");
}

async function startSimulator() {
  if (!fs.existsSync(SIMULATOR_EXE)) {
    throw new Error(
      `UHPPOTE simulator is missing at ${SIMULATOR_EXE}. Download and extract the Windows binary into .tools/uhppote-simulator first.`,
    );
  }

  fs.mkdirSync(SIMULATOR_DEVICES_DIR, { recursive: true });

  simulatorProcess = spawn(
    SIMULATOR_EXE,
    [
      "--bind",
      `127.0.0.1:${SIMULATOR_BIND_PORT}`,
      "--rest",
      `127.0.0.1:${SIMULATOR_REST_PORT}`,
      "--devices",
      SIMULATOR_DEVICES_DIR,
    ],
    {
      cwd: ADAPTER_ROOT,
      stdio: "ignore",
    },
  );

  await waitForSimulatorReady();

  for (const controllerId of [CONTROLLER_ID, CONTROLLER_ID_2]) {
    try {
      await axios.delete(`${SIMULATOR_REST}/uhppote/simulator/${controllerId}`);
    } catch {
      // Ignore if controller does not exist yet.
    }

    await axios.post(`${SIMULATOR_REST}/uhppote/simulator`, {
      "device-id": controllerId,
      "device-type": "UT0311-L04",
      compressed: false,
    });
  }
}

async function stopSimulator() {
  if (!simulatorProcess) {
    return;
  }

  const processToStop = simulatorProcess;
  simulatorProcess = undefined;

  if (processToStop.killed || processToStop.exitCode !== null) {
    return;
  }

  processToStop.kill("SIGTERM");
  await wait(500);

  if (processToStop.exitCode === null) {
    processToStop.kill("SIGKILL");
  }
}

async function waitForState(harness, id, predicate, timeoutMs = 20000, pollMs = 250) {
  const started = Date.now();

  while (Date.now() - started < timeoutMs) {
    const state = await harness.states.getStateAsync(id);
    if (state && predicate(state)) {
      return state;
    }
    await wait(pollMs);
  }

  throw new Error(`Timed out waiting for state ${id}`);
}

tests.integration(path.join(__dirname, ".."), {
  defineAdditionalTests({ suite }) {
    suite("UHPPOTE simulator regression", (getHarness) => {
      /** @type {import("@iobroker/testing/build/tests/integration/lib/harness").TestHarness} */
      let harness;

      before(async function () {
        this.timeout(30000);
        harness = getHarness();
        await startSimulator();
      });

      after(async function () {
        this.timeout(10000);
        await stopSimulator();
      });

      it("connects and processes a simulated swipe event", async function () {
        this.timeout(60000);

        await harness.changeAdapterConfig("wiegand-tcpip", {
          native: {
            bind: "127.0.0.1",
            port: SIMULATOR_BIND_PORT,
            r_port: 60099,
            timeout: 2500,
            heartbeat: 3000,
            settime: 60000,
            debugLL: false,
            controllers: [
              {
                serial: CONTROLLER_ID,
                deviceIp: "127.0.0.1",
                exposedIP: "127.0.0.1",
                exposedPort: 60099,
                modelType: 4,
                broadcast: false,
                index: 1,
                errorCount: 0,
                run: false,
                heartbeatCount: 0,
                eventNr: 0,
              },
              {
                serial: CONTROLLER_ID_2,
                deviceIp: "127.0.0.1",
                exposedIP: "127.0.0.1",
                exposedPort: 60099,
                modelType: 4,
                broadcast: false,
                index: 2,
                errorCount: 0,
                run: false,
                heartbeatCount: 0,
                eventNr: 0,
              },
            ],
          },
        });

        await harness.startAdapterAndWait();

        await waitForState(
          harness,
          `wiegand-tcpip.0.controllers.${CONTROLLER_ID}.reachable`,
          (state) => state.val === true,
          30000,
        );

        await waitForState(
          harness,
          `wiegand-tcpip.0.controllers.${CONTROLLER_ID_2}.reachable`,
          (state) => state.val === true,
          30000,
        );

        await waitForState(
          harness,
          `wiegand-tcpip.0.controllers.${CONTROLLER_ID}.1.control`,
          (state) => typeof state.val === "number",
          20000,
        );

        await waitForState(
          harness,
          `wiegand-tcpip.0.controllers.${CONTROLLER_ID}.1.delay`,
          (state) => typeof state.val === "number",
          20000,
        );

        await axios.put(
          `${SIMULATOR_REST}/uhppote/simulator/${CONTROLLER_ID}/cards/${AUTH_CARD}`,
          {
            "start-date": "2026-01-01",
            "end-date": "2027-12-31",
            doors: [1],
            PIN: 1357,
          },
        );

        await axios.post(`${SIMULATOR_REST}/uhppote/simulator/${CONTROLLER_ID}/swipe`, {
          door: 1,
          "card-number": AUTH_CARD,
          direction: 1,
          PIN: 1357,
        });

        await waitForState(
          harness,
          `wiegand-tcpip.0.controllers.${CONTROLLER_ID}.1.lastSwipe`,
          (state) => state.val === AUTH_CARD,
          20000,
        );

        await waitForState(
          harness,
          `wiegand-tcpip.0.controllers.${CONTROLLER_ID}.1.lastGranted`,
          (state) => state.val === true,
          20000,
        );

        await waitForState(
          harness,
          `wiegand-tcpip.0.controllers.${CONTROLLER_ID}.1.directionCode`,
          (state) => typeof state.val === "number" && state.val > 0,
          20000,
        );

        await waitForState(
          harness,
          `wiegand-tcpip.0.controllers.${CONTROLLER_ID}.1.requestCode`,
          (state) => typeof state.val === "number" && state.val > 0,
          20000,
        );

        await waitForState(
          harness,
          `wiegand-tcpip.0.controllers.${CONTROLLER_ID}.1.reasonCode`,
          (state) => typeof state.val === "number",
          20000,
        );

        await waitForState(
          harness,
          `wiegand-tcpip.0.controllers.${CONTROLLER_ID}.1.directionText`,
          (state) => typeof state.val === "string" && state.val.length > 0,
          20000,
        );

        await waitForState(
          harness,
          `wiegand-tcpip.0.controllers.${CONTROLLER_ID}.1.requestText`,
          (state) => typeof state.val === "string" && state.val.length > 0,
          20000,
        );

        await waitForState(
          harness,
          `wiegand-tcpip.0.controllers.${CONTROLLER_ID}.1.reasonText`,
          (state) => typeof state.val === "string",
          20000,
        );

        await waitForState(
          harness,
          `wiegand-tcpip.0.controllers.${CONTROLLER_ID}.eventNr`,
          (state) => typeof state.val === "number" && state.val > 0,
          20000,
        );
      });

      it("marks unauthorized swipe events as denied", async function () {
        this.timeout(30000);

        await axios.post(`${SIMULATOR_REST}/uhppote/simulator/${CONTROLLER_ID}/swipe`, {
          door: 1,
          "card-number": DENIED_CARD,
          direction: 1,
          PIN: 0,
        });

        await waitForState(
          harness,
          `wiegand-tcpip.0.controllers.${CONTROLLER_ID}.1.unauthorized`,
          (state) => state.val === DENIED_CARD,
          20000,
        );

        await waitForState(
          harness,
          `wiegand-tcpip.0.controllers.${CONTROLLER_ID}.1.lastGranted`,
          (state) => state.val === false,
          20000,
        );

        await waitForState(
          harness,
          `wiegand-tcpip.0.controllers.${CONTROLLER_ID}.1.lastSwipe`,
          (state) => state.val === DENIED_CARD,
          20000,
        );
      });

      it("handles remoteOpen state changes and updates event counter", async function () {
        this.timeout(30000);

        const eventStateId = `wiegand-tcpip.0.controllers.${CONTROLLER_ID}.eventNr`;
        const remoteOpenStateId = `wiegand-tcpip.0.controllers.${CONTROLLER_ID}.1.remoteOpen`;

        const previousEvent = await harness.states.getStateAsync(eventStateId);
        const previousEventNr = Number(previousEvent?.val || 0);

        await harness.states.setStateAsync(remoteOpenStateId, {
          val: true,
          ack: false,
          from: "system.adapter.test.0",
        });

        await waitForState(
          harness,
          eventStateId,
          (state) => typeof state.val === "number" && state.val > previousEventNr,
          20000,
        );
      });

      it("supports messagebox commands (search + invalid)", async function () {
        this.timeout(30000);

        const searchResponse = await sendToAsync(harness, "search", {
          bind: "127.0.0.1",
        });

        if (!searchResponse || searchResponse.error) {
          throw new Error(`search command failed: ${JSON.stringify(searchResponse)}`);
        }

        const foundDevice = Array.isArray(searchResponse)
          ? searchResponse.find((entry) => entry && entry.deviceId === CONTROLLER_ID)
          : undefined;

        if (!foundDevice) {
          throw new Error(
            `search result does not include expected controller ${CONTROLLER_ID}: ${JSON.stringify(searchResponse)}`,
          );
        }

        const invalidResponse = await sendToAsync(harness, "not-a-command", {});

        if (!invalidResponse || !invalidResponse.error) {
          throw new Error(
            `invalid command did not return expected error response: ${JSON.stringify(invalidResponse)}`,
          );
        }
      });

      it("ignores remoteOpen state changes coming from adapter itself", async function () {
        this.timeout(30000);

        const eventStateId = `wiegand-tcpip.0.controllers.${CONTROLLER_ID}.eventNr`;
        const remoteOpenStateId = `wiegand-tcpip.0.controllers.${CONTROLLER_ID}.1.remoteOpen`;

        const before = await harness.states.getStateAsync(eventStateId);
        const beforeNr = Number(before?.val || 0);

        await harness.states.setStateAsync(remoteOpenStateId, {
          val: true,
          ack: false,
          from: "system.adapter.wiegand-tcpip.0",
        });

        await wait(1500);

        const after = await harness.states.getStateAsync(eventStateId);
        const afterNr = Number(after?.val || 0);

        if (afterNr !== beforeNr) {
          throw new Error(`eventNr changed unexpectedly for own-state remoteOpen (${beforeNr} -> ${afterNr})`);
        }
      });

      it("handles setip messagebox command callback", async function () {
        this.timeout(30000);

        const response = await sendToAsync(harness, "setip", {
          bind: "127.0.0.1",
          deviceId: CONTROLLER_ID,
          address: "not-an-ip",
          netmask: "255.255.255.0",
          gateway: "127.0.0.1",
        });

        if (response == null || typeof response !== "object") {
          throw new Error(`setip should return an object response, got: ${JSON.stringify(response)}`);
        }
      });

      it("supports user management commands and event-based card merge", async function () {
        this.timeout(40000);

        const managedUserId = "qa-user-1";

        const upsertResponse = await sendToAsync(harness, "userUpsert", {
          user: {
            id: managedUserId,
            displayName: "QA User",
            credentials: [
              {
                type: "card",
                value: AUTH_CARD,
                controllers: [CONTROLLER_ID],
              },
              {
                type: "pin",
                value: "1357",
                controllers: [CONTROLLER_ID],
              },
            ],
          },
        });

        if (!upsertResponse || upsertResponse.error || !upsertResponse.user) {
          throw new Error(`userUpsert failed: ${JSON.stringify(upsertResponse)}`);
        }

        const getResponse = await sendToAsync(harness, "userGet", {
          userId: managedUserId,
        });

        if (!getResponse || getResponse.error || !getResponse.user || getResponse.user.id !== managedUserId) {
          throw new Error(`userGet failed: ${JSON.stringify(getResponse)}`);
        }

        await axios.post(`${SIMULATOR_REST}/uhppote/simulator/${CONTROLLER_ID}/swipe`, {
          door: 1,
          "card-number": DENIED_CARD,
          direction: 1,
          PIN: 0,
        });

        await wait(1500);

        const listResponse = await sendToAsync(harness, "userList", {});
        if (!listResponse || listResponse.error || !Array.isArray(listResponse.users)) {
          throw new Error(`userList failed: ${JSON.stringify(listResponse)}`);
        }

        const autoUser = listResponse.users.find((user) =>
          Array.isArray(user.credentials)
          && user.credentials.some(
            (credential) => credential.type === "card" && credential.value === String(DENIED_CARD),
          ),
        );

        if (!autoUser) {
          throw new Error(`event-based credential merge failed, missing auto user for ${DENIED_CARD}`);
        }

        const deleteResponse = await sendToAsync(harness, "userDelete", {
          userId: managedUserId,
        });

        if (!deleteResponse || deleteResponse.error || deleteResponse.deleted !== true) {
          throw new Error(`userDelete failed: ${JSON.stringify(deleteResponse)}`);
        }
      });

      it("merges card observations across multiple controllers", async function () {
        this.timeout(40000);

        await axios.post(`${SIMULATOR_REST}/uhppote/simulator/${CONTROLLER_ID}/swipe`, {
          door: 1,
          "card-number": MERGE_CARD,
          direction: 1,
          PIN: 0,
        });

        await axios.post(`${SIMULATOR_REST}/uhppote/simulator/${CONTROLLER_ID_2}/swipe`, {
          door: 1,
          "card-number": MERGE_CARD,
          direction: 1,
          PIN: 0,
        });

        await wait(2000);

        const listResponse = await sendToAsync(harness, "userList", {});
        if (!listResponse || listResponse.error || !Array.isArray(listResponse.users)) {
          throw new Error(`userList failed: ${JSON.stringify(listResponse)}`);
        }

        const mergedUser = listResponse.users.find((user) =>
          Array.isArray(user.credentials)
          && user.credentials.some(
            (credential) => credential.type === "card" && credential.value === String(MERGE_CARD),
          ),
        );

        if (!mergedUser) {
          throw new Error(`missing merged user for card ${MERGE_CARD}`);
        }

        const cardCredential = mergedUser.credentials.find(
          (credential) => credential.type === "card" && credential.value === String(MERGE_CARD),
        );

        const controllers = Array.isArray(cardCredential?.controllers)
          ? cardCredential.controllers.map(Number)
          : [];

        if (!controllers.includes(CONTROLLER_ID) || !controllers.includes(CONTROLLER_ID_2)) {
          throw new Error(
            `expected merged credential controllers to include both IDs, got: ${JSON.stringify(controllers)}`,
          );
        }
      });

      it("supports import preview and apply across multiple controllers", async function () {
        this.timeout(30000);

        const importDataset = {
          source: "simulator-upload",
          controllers: [
            {
              serial: CONTROLLER_ID,
              entries: [
                {
                  displayName: "Import User",
                  card: 20010001,
                  pin: "2222",
                },
              ],
            },
            {
              serial: CONTROLLER_ID_2,
              entries: [
                {
                  displayName: "Import User",
                  card: 20010001,
                },
              ],
            },
          ],
        };

        const previewResponse = await sendToAsync(harness, "userImportPreview", {
          dataset: importDataset,
        });

        if (
          !previewResponse
          || previewResponse.error
          || !previewResponse.preview
          || previewResponse.preview.pendingReviews < 1
          || previewResponse.preview.canApply !== false
        ) {
          throw new Error(`userImportPreview failed: ${JSON.stringify(previewResponse)}`);
        }

        const blockedApply = await sendToAsync(harness, "userImportApply", {
          dataset: importDataset,
        });

        if (!blockedApply || blockedApply.error || !blockedApply.result || blockedApply.result.reason !== "reviewPending") {
          throw new Error(`userImportApply should be blocked by review queue: ${JSON.stringify(blockedApply)}`);
        }

        const reviewListResponse = await sendToAsync(harness, "userImportReviewList", {});
        if (
          !reviewListResponse
          || reviewListResponse.error
          || !Array.isArray(reviewListResponse.reviews)
          || reviewListResponse.reviews.length < 1
        ) {
          throw new Error(`userImportReviewList failed: ${JSON.stringify(reviewListResponse)}`);
        }

        for (const review of reviewListResponse.reviews) {
          const action = review.decisionType === "merge" ? "merge" : "create";
          const approveResponse = await sendToAsync(harness, "userImportReviewApprove", {
            reviewId: review.id,
            action,
            userId: review.suggestedUserId,
          });
          if (!approveResponse || approveResponse.error || !approveResponse.review) {
            throw new Error(`userImportReviewApprove failed: ${JSON.stringify(approveResponse)}`);
          }
        }

        const applyResponse = await sendToAsync(harness, "userImportApply", {
          dataset: importDataset,
        });

        if (!applyResponse || applyResponse.error || !applyResponse.result || applyResponse.result.applied !== true) {
          throw new Error(`userImportApply failed: ${JSON.stringify(applyResponse)}`);
        }

        const listResponse = await sendToAsync(harness, "userList", {});
        if (!listResponse || listResponse.error || !Array.isArray(listResponse.users)) {
          throw new Error(`userList failed after import: ${JSON.stringify(listResponse)}`);
        }

        const importedUser = listResponse.users.find((user) =>
          Array.isArray(user.credentials)
          && user.credentials.some(
            (credential) => credential.type === "card" && credential.value === "20010001",
          ),
        );

        if (!importedUser) {
          throw new Error("imported card user not found");
        }

        const importedCard = importedUser.credentials.find(
          (credential) => credential.type === "card" && credential.value === "20010001",
        );
        const importedControllers = Array.isArray(importedCard?.controllers)
          ? importedCard.controllers.map(Number)
          : [];

        if (!importedControllers.includes(CONTROLLER_ID) || !importedControllers.includes(CONTROLLER_ID_2)) {
          throw new Error(
            `imported credential is missing multi-controller merge: ${JSON.stringify(importedControllers)}`,
          );
        }
      });

      it("runs import apply as background job and reports completion", async function () {
        this.timeout(40000);

        const importDataset = {
          source: "simulator-upload",
          controllers: [
            {
              serial: CONTROLLER_ID,
              entries: [
                {
                  displayName: "Background Import",
                  card: 20020002,
                  pin: "2233",
                },
              ],
            },
            {
              serial: CONTROLLER_ID_2,
              entries: [
                {
                  displayName: "Background Import",
                  card: 20020002,
                },
              ],
            },
          ],
        };

        const previewResponse = await sendToAsync(harness, "userImportPreview", {
          dataset: importDataset,
        });

        if (!previewResponse || previewResponse.error || !previewResponse.preview) {
          throw new Error(`userImportPreview failed for background flow: ${JSON.stringify(previewResponse)}`);
        }

        const reviewListResponse = await sendToAsync(harness, "userImportReviewList", {});
        if (
          !reviewListResponse
          || reviewListResponse.error
          || !Array.isArray(reviewListResponse.reviews)
          || reviewListResponse.reviews.length < 1
        ) {
          throw new Error(`userImportReviewList failed for background flow: ${JSON.stringify(reviewListResponse)}`);
        }

        const backgroundReviews = reviewListResponse.reviews.filter((review) =>
          Array.isArray(review?.record?.credentials)
          && review.record.credentials.some((credential) => String(credential.value) === "20020002"),
        );

        if (backgroundReviews.length < 1) {
          throw new Error(`missing review items for background import card: ${JSON.stringify(reviewListResponse)}`);
        }

        for (const review of backgroundReviews) {
          const action = review.decisionType === "merge" ? "merge" : "create";
          const approveResponse = await sendToAsync(harness, "userImportReviewApprove", {
            reviewId: review.id,
            action,
            userId: review.suggestedUserId,
          });
          if (!approveResponse || approveResponse.error || !approveResponse.review) {
            throw new Error(`userImportReviewApprove failed for background flow: ${JSON.stringify(approveResponse)}`);
          }
        }

        const applyResponse = await sendToAsync(harness, "userImportApply", {
          dataset: importDataset,
          background: true,
        });

        if (!applyResponse || applyResponse.error || applyResponse.accepted !== true || !applyResponse.jobId) {
          throw new Error(`background userImportApply did not return job acceptance: ${JSON.stringify(applyResponse)}`);
        }

        const completedJob = await waitForJobStatus(
          harness,
          applyResponse.jobId,
          ["completed", "failed"],
          25000,
          250,
        );

        if (completedJob.status !== "completed") {
          throw new Error(`background import job failed: ${JSON.stringify(completedJob)}`);
        }

        const listResponse = await sendToAsync(harness, "userList", {});
        if (!listResponse || listResponse.error || !Array.isArray(listResponse.users)) {
          throw new Error(`userList failed after background import: ${JSON.stringify(listResponse)}`);
        }

        const importedUser = listResponse.users.find((user) =>
          Array.isArray(user.credentials)
          && user.credentials.some(
            (credential) => credential.type === "card" && credential.value === "20020002",
          ),
        );

        if (!importedUser) {
          throw new Error("background imported card user not found");
        }
      });

      it("supports sync preview and background sync apply with selection", async function () {
        this.timeout(40000);

        const syncUserId = "sync-user-1";
        const upsertResponse = await sendToAsync(harness, "userUpsert", {
          user: {
            id: syncUserId,
            displayName: "Sync User",
            credentials: [
              {
                type: "card",
                value: 30030003,
                controllers: [CONTROLLER_ID],
              },
              {
                type: "pin",
                value: "3030",
                controllers: [CONTROLLER_ID],
              },
            ],
          },
        });

        if (!upsertResponse || upsertResponse.error || !upsertResponse.user) {
          throw new Error(`userUpsert failed for sync flow: ${JSON.stringify(upsertResponse)}`);
        }

        const previewResponse = await sendToAsync(harness, "userSyncPreview", {
          mode: "overwrite",
          userIds: [syncUserId],
          controllerIds: [CONTROLLER_ID],
        });

        if (
          !previewResponse
          || previewResponse.error
          || !previewResponse.preview
          || previewResponse.preview.totalActions < 1
          || previewResponse.preview.actionable < 1
        ) {
          throw new Error(`userSyncPreview failed: ${JSON.stringify(previewResponse)}`);
        }

        const applyResponse = await sendToAsync(harness, "userSyncApply", {
          mode: "overwrite",
          userIds: [syncUserId],
          controllerIds: [CONTROLLER_ID],
          background: true,
        });

        if (!applyResponse || applyResponse.error || applyResponse.accepted !== true || !applyResponse.jobId) {
          throw new Error(`userSyncApply background did not return job acceptance: ${JSON.stringify(applyResponse)}`);
        }

        const completedJob = await waitForJobStatus(
          harness,
          applyResponse.jobId,
          ["completed", "failed"],
          25000,
          250,
        );

        if (completedJob.status !== "completed") {
          throw new Error(`background sync job failed: ${JSON.stringify(completedJob)}`);
        }

        const syncResult = completedJob.result;
        if (!syncResult || syncResult.applied !== true || !Array.isArray(syncResult.updatedUsers)) {
          throw new Error(`invalid background sync result: ${JSON.stringify(completedJob)}`);
        }

        if (!syncResult.updatedUsers.includes(syncUserId)) {
          throw new Error(`sync user was not updated by sync apply: ${JSON.stringify(syncResult)}`);
        }

        const getResponse = await sendToAsync(harness, "userGet", {
          userId: syncUserId,
        });

        const syncMeta = getResponse?.user?.meta?.syncMeta?.[CONTROLLER_ID];
        if (!syncMeta || syncMeta.mode !== "overwrite" || !syncMeta.lastSyncAt) {
          throw new Error(`sync metadata not persisted: ${JSON.stringify(getResponse)}`);
        }
      });

      it("supports controller-scoped validation and reconcile preview", async function () {
        this.timeout(30000);

        const validationUserId = "validation-user-1";
        const upsertResponse = await sendToAsync(harness, "userUpsert", {
          user: {
            id: validationUserId,
            displayName: "Validation User",
            credentials: [
              {
                type: "card",
                value: 44440001,
                controllers: [CONTROLLER_ID, 999999],
              },
            ],
          },
        });

        if (!upsertResponse || upsertResponse.error || !upsertResponse.user) {
          throw new Error(`userUpsert failed for validation flow: ${JSON.stringify(upsertResponse)}`);
        }

        const scopedValidateKnown = await sendToAsync(harness, "userValidate", {
          controllerIds: [CONTROLLER_ID],
        });

        if (!scopedValidateKnown || scopedValidateKnown.error || !scopedValidateKnown.report) {
          throw new Error(`userValidate failed for known controller scope: ${JSON.stringify(scopedValidateKnown)}`);
        }

        if ((scopedValidateKnown.report.unknownControllerReferences || []).length !== 0) {
          throw new Error(`known controller scope should have no unknown refs: ${JSON.stringify(scopedValidateKnown)}`);
        }

        const scopedReconcileUnknown = await sendToAsync(harness, "userReconcilePreview", {
          controllerIds: [999999],
        });

        if (!scopedReconcileUnknown || scopedReconcileUnknown.error || !scopedReconcileUnknown.report) {
          throw new Error(`userReconcilePreview failed for unknown controller scope: ${JSON.stringify(scopedReconcileUnknown)}`);
        }

        const unknownRefs = scopedReconcileUnknown.report.unknownControllerReferences || [];
        if (unknownRefs.length < 1) {
          throw new Error(`unknown controller scope should include unknown refs: ${JSON.stringify(scopedReconcileUnknown)}`);
        }

        const selectedControllers = scopedReconcileUnknown.report.selectedControllers || [];
        if (!selectedControllers.includes(999999)) {
          throw new Error(`selected controller scope missing in report: ${JSON.stringify(scopedReconcileUnknown)}`);
        }

        const suggestions = scopedReconcileUnknown.report.suggestions || {};
        if (typeof suggestions.removeUnknownControllerRefs !== "number" || suggestions.removeUnknownControllerRefs < 1) {
          throw new Error(`reconcile suggestions missing unknown-ref action: ${JSON.stringify(scopedReconcileUnknown)}`);
        }
      });
    });
  },
});
