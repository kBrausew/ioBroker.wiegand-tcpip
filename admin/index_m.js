// @ts-nocheck
// @ts-ignore
/* eslint-disable no-var */
/* eslint-disable no-unused-vars */
/* eslint-disable no-undef */
// This will be called by the admin adapter when the settings page loads

//const p = require("proxyquire");

var controllers = [];
var ctrls = [];

function load(settings, onChange) {
    // example: select elements with id=key and class=value and insert value
    if (!settings) return;

    fillSelectIPs("#bind", settings.bind, false, true, function () {
        $("#bind").select();
    });

    $(".value").each(function () {
        var $key = $(this);
        var id = $key.attr("id");
        if ($key.attr("type") === "checkbox") {
            // do not call onChange direct, because onChange could expect some arguments
            $key.prop("checked", settings[id])
                .on("change", () => onChange());
        } else {
            // do not call onChange direct, because onChange could expect some arguments
            $key.val(settings[id])
                .on("change", () => onChange())
                .on("keyup", () => onChange());
        }
    });

    //Setup Button
    $("#setip_ok_btn").addClass("disabled");

    //Button0
    $("#setip_btn").click(function () {
        var setip_serial = $("#setip_serial");
        setip_serial.empty();
        setip_serial.select();
        $("#setip_btn").addClass("disabled");
        ctrls = [];

        getIsAdapterAlive(function (isAlive) {
            if (!isAlive) {
                showToast(_("adapter-not-started"));
                $("#setip_btn").removeClass("disabled");
            } else {
                sendTo(null, "search", { bind: $("#bind").val() }, function (uRet) {
                    if (uRet && uRet.err) {
                        const lErr = uRet.err.message || "Unknow error";
                        showToast(lErr);
                    } else if (Array.isArray(uRet) && uRet.length > 0) {
                        uRet.forEach(lC => {
                            if (lC && lC.device && lC.device.serialNumber) {
                                const l_option = new Option(lC.device.serialNumber.toString(), ctrls.length.toString(), false, false);
                                setip_serial.append(l_option);
                                ctrls.push({ "index": ctrls.length, "ctrl": lC });
                            }
                        });
                        setip_serial.select();
                        setip_serial.change();
                    } else {
                        showToast(_("no-controller"));
                    }
                    $("#setip_btn").removeClass("disabled");
                });
            }
        });
    });

    $("#setip_ok_btn").click(function () {
        $("#setip_ok_btn").addClass("disabled");
        getIsAdapterAlive(function (isAlive) {
            if (!isAlive) {
                showToast(_("adapter-not-started"));
                $("#setip_ok_btn").removeClass("disabled");
            } else {
                sendTo(null, "setip", {
                    "deviceId": $("#setip_serial_nr").val(),
                    "address": $("#setip_ip").val(),
                    "netmask": $("#setip_mask").val(),
                    "gateway": $("#setip_gateway").val()
                }, function (uRet) {
                    if (uRet && uRet.err) {
                        const lErr = uRet.err.message || "Unknow error";
                        showToast(lErr);
                        $("#setip_ok_btn").removeClass("disabled");
                    } else if (uRet) {
                        showToast(_("op-ok"));
                        ctrls = [];
                        $("#setip_serial").empty();
                        $("#setip_serial").select();
                        $("#setip_serial").change();
                    } else {
                        showToast(_("unknow-message"));
                        $("#setip_ok_btn").removeClass("disabled");
                    }
                });
            }
        });
    });

    $("#setip_serial").change(function () {
        $("#setip_ok_btn").addClass("disabled");
        $("#setip_serial_nr").val("");
        $("#setip_ip").val("");
        $("#setip_mask").val("");
        $("#setip_gateway").val("");
        $("#setip_serial option:selected").each(function () {
            const $that = $(this);
            if ($that) {
                const $val = $that.val();
                const $ctrl = ctrls[$val];
                if ($ctrl) {
                    $("#setip_serial_nr").val($ctrl.ctrl.deviceId);
                    $("#setip_ip").val($ctrl.ctrl.device.address);
                    $("#setip_mask").val($ctrl.ctrl.device.netmask);
                    $("#setip_gateway").val($ctrl.ctrl.device.gateway);
                    $("#setip_ok_btn").removeClass("disabled");
                }
            }
        });
        $("#setip_gateway").focus();
        $("#setip_mask").focus();
        $("#setip_ip").focus();
    });
    //Button end

    controllers = settings.controllers || [];
    values2table("controllers", controllers, onChange);
    cards = settings.cards || [];
    values2table("cards", cards, onChange);
    onChange(false);
    // reinitialize all the Materialize labels on the page if you are dynamically adding inputs:
    if (M) M.updateTextFields();
}

// This will be called by the admin adapter when the user presses the save button
function save(callback) {
    // example: select elements with class=value and build settings object
    var obj = {};
    $(".value").each(function () {
        var $this = $(this);
        if ($this.attr("type") === "checkbox") {
            obj[$this.attr("id")] = $this.prop("checked");
        } else if ($this.attr("type") === "number") {
            obj[$this.attr("id")] = parseFloat($this.val());
        } else {
            obj[$this.attr("id")] = $this.val();
        }
    });

    obj.controllers = table2values("controllers");
    obj.cards = table2values("cards");

    callback(obj);
}