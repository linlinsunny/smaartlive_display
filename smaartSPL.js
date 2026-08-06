// =============================================================================
//
// Copyright (c) 2019, Rational Acoustics LLC, All Rights Reserved
//
// smaartSPL.js
//
// =============================================================================


/** Global Data */

var serverProbe;
var nextMeterIndex = 0;
var meterListeners = {};
var meterErrorHandlers = {};
var plotErrorHandlers = {};
var plotData = [];
var plotAlarms = [];
var plotCanvaas;

var plotBorderColor = 'black';


const AxisWidth = 30;
const AxisLabelCount = 7;
const PlotVerticalPadding = 20;


window.onbeforeunload = function () {

    if (serverProbe)
    {
        var list = serverProbe.getStreamingInputs ();

        var count = list.length;
        for (var i = 0; count > i; ++i)
        {
            list [i].forceDisconnect ();
        }

        serverProbe.disconnect ();
        delete serverProbe;
        serverProbe = null;
    }
};


window.setInterval (updateClock, 20 * 1000);


// =============================================================================
/** Input Definition */

class Input {

    constructor (device, channel, stream, log) {

        this.deviceName = device;
        this.channelName = channel;
        this.streamEndpoint = stream;
        this.logEndpoint = log;

        this.alarms = [];
    }
};


// =============================================================================
/** StreamingInput Definition */

class StreamingInput
{
    constructor (stream)
    {
        this.streamEndpoint = stream;
        this.referenceCount = 0;
        this.listeners = [];
        this.errorHandlers = [];
        this.framerate = 1;

        this.socket;
    }

    connect ()
    {
        if (this.socket && this.socket.OPEN)
        {
            this.referenceCount += 1;
        }
        else
        {
            console.assert (0 == this.referenceCount,
                    'reference count expected to be zero: ' + this.referenceCount);

            this.attemptConnection ();
        }
    }

    disconnect ()
    {
        this.referenceCount -= 1;

        if (0 == this.referenceCount)
        {
            this.socket.close ();

            this.socket = null;
        }
    }

    forceDisconnect () {

        if (this.socket) {

            this.referenceCount = 0;
            this.listeners = [];
            this.socket.close ();
            this.socket = null;
        }
    }

    setFramerate (framerate) {

        this.framerate = framerate;

        if (this.socket && this.socket.OPEN) {

            var message = "{\"action\":\"set\",\"properties\":[{\"targetFPS\":"
                + framerate + "}]}";

            this.socket.send (message);
        }
    }

    addListener (listener)
    {
        this.listeners.push (listener);
    }

    removeListener (listener)
    {
        var count = this.listeners.length;
        for (var i = 0; count > i; ++i)
        {
            if (listener == this.listeners [i])
            {
                this.listeners.splice (i, 1);
                break;
            }
        }
    }

    addErrorHandler (handler) {

        this.errorHandlers.push (handler);
    }

    removeErrorHandler (handler) {

        var count = this.errorHandlers.length;
        for (var i = 0; count > i; ++i)
        {
            if (handler == this.errorHandlers [i])
            {
                this.errorHandlers.splice (i, 1);
                break;
            }
        }
    }

    attemptConnection () {

        this.socket = new WebSocket (this.streamEndpoint);

        this.referenceCount = 1;

        this.socket.onopen = e =>
        {
            var message = "{\"action\":\"set\",\"properties\":[{\"targetFPS"
                + "\":" + this.framerate + "}]}";

            this.socket.send (message);
        };

        this.socket.onmessage = e =>
        {
            var parsed;

            try { parsed = JSON.parse (e.data); }

            catch (exception) { console.log ("parse error: " + e.data); }

            if (parsed)
            {
                var count = this.listeners.length;
                for (var i = 0; count > i; ++i)
                {
                    this.listeners [i] (parsed);
                }
            }
        };

        this.socket.onerror = e => { };

        this.socket.onclose = e => {

            if (false == e.wasClean) {

                var age = Date.now () - performance.timing.connectStart;

                // if less than ten seconds from page load, retry
                if (10000 > age) {

                    // arrow function captures this in lexical scope
                    setTimeout (() => { this.attemptConnection () }, 1000);

                } else {

                    var count = this.errorHandlers.length;
                    for (var i = 0; count > i; ++i)
                    {
                        this.errorHandlers [i] ();
                    }
                }
            }
        };
    }
}


// =============================================================================
/** ServerProbe Definition */

class ServerProbe
{
    constructor (host)
    {
        this.host = host;
        this.inputs = [];
        this.streamingInputs = [];
        this.metrics = [];
        this.framerate = 1;
    }

    onConnectionClose (reason) { }
    onProbeComplete (probe) { }

    connect ()
    {
        this.attemptConnection ();
    }

    disconnect ()
    {
        if (this.socket != null)
        {
            this.socket.close ();
        }
    }

    setFramerate (framerate) {

        this.framerate = framerate;

        if (this.streamingInputs) {

            var count = this.streamingInputs.length;
            for (var i = 0; count > i; ++i) {

                this.streamingInputs [i].setFramerate (framerate);
            }
        }
    }

    getStreamingInputs ()
    {
        return this.streamingInputs;
    }

    getMetrics ()
    {
        return this.metrics;
    }

    getAuthenticationHandler () {

        return event => {

            var parsed = JSON.parse (event.data);

            if (parsed.response.status) {

                this.socket.onmessage = this.getDataHandler ();

                var message = "{\"action\":\"get\","
                    + "\"target\":\"activeCalibratedInputs\"}";

                this.socket.send (message);

            } else {

                var password = prompt ("Smaart API password:");

                var message = "{\"action\":\"set\",\"properties\":[{\"password\":\""
                    + password + "\"}]}";

                this.socket.send (message);
            }
        }
    }

    getDataHandler () {

        return event => {

            var parsed = JSON.parse (event.data);

            var deviceCount = parsed.response.devices.length;

            for (var i = 0; deviceCount > i; i++)
            {
                var device = parsed.response.devices [i];

                var deviceName = device.deviceName;

                var channelCount = device.activeCalibratedChannels.length;

                for (var j = 0; channelCount > j; ++j)
                {
                    var channel = device.activeCalibratedChannels [j];

                    var channelName = channel.channelName;

                    var stream = "ws://" + this.host + channel.streamEndpoint;

                    var si = new StreamingInput (stream);

                    si.setFramerate (this.framerate);

                    this.streamingInputs.push (si);

                    var input = new Input (deviceName, channelName, stream,
                            channel.logEndpointPrefix);

                    var alarms = channel.alarms;

                    if (alarms && alarms.length) {

                        // clone the alarms object
                        input.alarms = (JSON.parse (JSON.stringify (alarms)));
                    }

                    this.inputs.push (input);
                }
            }

            var metrics = parsed.response.metrics;

            var metricCount = metrics.length;
            for (var i = 0; metricCount > i; ++i)
            {
                var metric = metrics [i];

                if ("FS Peak" != metric) {

                    this.metrics.push (metric);
                }
            }

            if (0 < this.streamingInputs.length)
            {
                this.onProbeComplete (this);
            }
        };
    }

    attemptConnection () {

        this.socket = new WebSocket ("ws://" + this.host + "/api/v3/");

        if (this.socket) {
        } else {
            console.log ("got no socket in probe");
        }

        this.socket.onopen = e => {

            this.socket.send ("{\"action\":\"get\"}");
        }

        this.socket.onmessage = event => {

            var parsed = JSON.parse (event.data);

            if (parsed.response.authenticationRequired) {

                var password;

                do {

                    password = prompt ("Smaart API password:");

                } while (password === "");

                if (password)
                {
                    var message = "{\"action\":\"set\",\"properties\""
                        + ":[{\"password\":\"" + password + "\"}]}";

                    this.socket.onmessage = this.getAuthenticationHandler ();

                    this.socket.send (message);
                }

            } else {

                this.socket.onmessage = this.getDataHandler ();

                var message = "{\"action\":\"get\","
                    + "\"target\":\"activeCalibratedInputs\"}";

                this.socket.send (message);
            }
        };

        this.socket.onclose = event =>
        {
            this.onConnectionClose (event.data);
        };

        this.socket.onerror = error =>
        {
        };
    }

}   // ServerProbe


// =============================================================================
/** PlotData Definition */

class PlotData
{
    construct () {

        this.logStream = null;
        this.logStreamDelegate = null;
        this.logStreamErrorHandler = null;
        this.listener = null;
        this.data = [];
        this.metric = '';
        this.timeWindow = 0;
    }

    setListener (listener) {

        this.listener = listener;
    }

    connect (metric, stream) {

        this.disconnect ();

        this.logStream = new StreamingInput (stream);

        if (this.logStream) {

            // give static callback function access to the this pointer
            this.logStreamDelegate = PlotData.onStreamDataAvailable.bind (this); 

            this.logStream.addListener (this.logStreamDelegate);
            this.logStream.addErrorHandler (this.logStreamErrorHandler);
            this.logStream.connect ();

            this.metric = metric;
        }
    }

    disconnect () {

        if (this.logStream) {

            if (this.logStreamDelegate) {

                this.logStream.removeListener (this.logStreamDelegate);
            }

            this.logStream.disconnect ();
            this.logStreamDelegate = null;
            this.logStream = null;
        }

        this.data = [];
        this.metric = '';
    }

    reconnect () {

        this.connect (this.metric, this.logStream.streamEndpoint);
    }

    setTimeWindow (minutes) {

        this.timeWindow = minutes * 60 * 1000;
    }

    size () {

        var size = 0;

        if (this.data) {

            size = this.data.length;
        }

        return size;
    }

    purgeOldData (minutes) {

        if (0 < minutes && this.data.length) {

            var milliseconds = minutes * 60 * 1000;

            var lastTime = this.data [this.data.length - 1]['milliseconds'];

            while (milliseconds < lastTime - this.data [0]['milliseconds']) {

                this.data.shift ();
            }
        }
    }

    getTimeWindowStartIndex () {

        var index = -1;

        if (this.data.length) {

            index = 0;

            if (0 < this.timeWindow) {

                var lastTime = this.data [this.data.length - 1]['milliseconds'];

                while (this.timeWindow < lastTime - this.data [index++]['milliseconds']) ;
            }
        }

        return index;
    }

    getTime (index) {

        var time;

        if (this.data.length > index) {

            time = this.data [index]['milliseconds'];
        }

        return time;
    }

    getValue (index) {

        var value;

        if (this.data.length > index) {

            value = this.data [index]['value'];
        }

        return value;
    }

    getValueRange (startIndex) {

        var minValue = 9999;
        var maxValue = -9999;

        var count = this.data.length;
        for (var i = startIndex; count > i; ++i)
        {
            var value = this.data [i]['value'];

            if (false == this.data [i]['overload'] && -999 < value) {

                minValue = Math.min (minValue, value);
                maxValue = Math.max (maxValue, value);
            }
        }

        return { min: minValue, max: maxValue };
    }

    setErrorHandler (handler) {

        this.logStreamErrorHandler = handler;
    }

    isOverload (index) {

        var overload = false;

        if (this.data.length > index) {

            overload = this.data [index]['overload'];
        }

        return overload;
    }

};  // PlotData

// static method to be used as a delegate - which requires binding this ptr
PlotData.onStreamDataAvailable = function (jsonObj) {

    var loggedData = jsonObj.loggedData;

    for (var i = 0; loggedData.length > i; ++i)
    {
        var dataPoint = loggedData [i];

        var overload = dataPoint.overload;

        var toPush = { milliseconds: Date.parse (dataPoint.timestamp),
            value: dataPoint.value,
            overload: (undefined !== overload && overload) };

        this.data.push (toPush);
    }

    if (this.listener)
    {
        this.listener ();
    }
}


// =============================================================================
/** LocalConfig Definition */

class LocalConfig {

    construct () {
    }

};  // LocalConfig


LocalConfig.set = function (name, value) {

    var attempt = escape (name) + "=" + escape (value)
        + "; expires=31 Dec 2030 23:59:59 UTC";

    document.cookie = attempt;
}

LocalConfig.get = function (name) {

    var allCookies = document.cookie;

    var cookiesArray = allCookies.split (';');

    var count = cookiesArray.length;
    for (var i = 0; count > i; ++i) {

        var cookie = cookiesArray [i];

        var cookieArray = cookie.split ('=');

        var candidate = unescape (cookieArray [0].trim ());

        if (name == candidate) {

            var value = unescape (cookieArray [1].trim ());

            return value;
        }
    }

    return undefined;
}


// =============================================================================
/** Global functions */

function refreshStreams ()
{
    // clear inputs
    var plotInputs = document.getElementById ("plotInputs");

    while (plotInputs.length)
    {
        plotInputs.remove (plotInputs.length - 1);
    }

    // make connection

    serverProbe = new ServerProbe (location.host);

    var framerateElement = document.getElementById ('meterFramerate');

    serverProbe.setFramerate (framerateElement.value);

    serverProbe.onProbeComplete = function (probe) {

        var inputs = probe.inputs;

        var count = inputs.length;
        for (var i = 0; count > i; ++i)
        {
            var input = inputs [i];

            var option = document.createElement ("option");
            option.text = input.deviceName + " : " + input.channelName;
            plotInputs.add (option);
        }

        var metrics = probe.getMetrics ();

        var firstMetric = document.getElementById ('plotMetric0');
        var secondMetric = document.getElementById ('plotMetric1');

        firstMetric.add (document.createElement ('option'));
        secondMetric.add (document.createElement ('option'));

        for (var i = 0; metrics.length > i; ++i)
        {
            var metric = metrics [i];

            var fOption = document.createElement ('option');
            fOption.text = metric;
            firstMetric.add (fOption);

            var sOption = document.createElement ('option');
            sOption.text = metric;
            secondMetric.add (sOption);
        }

        if (count)
        {
            try {

                initializeDefaultConfig (probe);
                applyLocalConfig ();

                // parse default metrics
                if (defaultConfig) {

                    var plotInput = defaultConfig ["plotInput"];

                    if (plotInput)
                    {
                        plotInputs.value = plotInput;
                        plotInputs.dispatchEvent (new Event ('change'));
                    }

                    var defaultMetrics = defaultConfig ["plotMetrics"];

                    if (defaultMetrics && 0 < defaultMetrics.length)
                    {
                        firstMetric.value = defaultMetrics [0];
                        firstMetric.dispatchEvent (new Event ('change'));

                        if (1 < defaultMetrics.length)
                        {
                            secondMetric.value = defaultMetrics [1];
                            secondMetric.dispatchEvent (new Event ('change'));
                        }
                    }

                    var timeWindow = defaultConfig ["plotTimeWindow"];

                    var twe = document.getElementById ("plotDisplayLast");

                    twe.value = timeWindow;
                    twe.dispatchEvent (new Event ('change'));

                    var meterFramerate = defaultConfig ['meterFramerate'];

                    if (meterFramerate) {

                        var element = document.getElementById ('meterFramerate');

                        element.value = meterFramerate;
                        element.dispatchEvent (new Event ('change'));
                    }

                    var meters = defaultConfig ["meters"];

                    if (meters)
                    {
                        var meterCount = meters.length;
                        for (var i = 0; meterCount > i; ++i)
                        {
                            createMeter (false);

                            var meter = meters [i];

                            var meterInput
                                = document.getElementById ('input' + i);

                            var meterOptions = meterInput.options;

                            var meterOptionCount = meterOptions.length;
                            for (var j = 0; meterOptionCount > j; ++j)
                            {
                                if (meter ['input'] == meterOptions [j].text)
                                {
                                    meterInput.selectedIndex = j;

                                    meterInput.dispatchEvent (
                                            new Event ('change'));
                                    break;
                                }
                            }

                            var meterMetric
                                = document.getElementById ('metric' + i);

                            meterMetric.value = meter ['metric'];

                            meterMetric.dispatchEvent (new Event ('change'));
                        }
                    }
                }

            } catch (e) { console.log (e); }

            var meterArray = document.getElementById ("meterArray");

            if (0 == meterArray.childElementCount)
            {
                createMeter (true);
            }
        }
    };

    serverProbe.connect ();
}

function disconnectFromServer ()
{
    if (serverProbe)
    {
        serverProbe.disconnect ();
    }
}

function meterInputChange (index)
{
    var list = serverProbe.getStreamingInputs ();

    // if a connection to the last input exists, remove it
    var oiie = document.getElementById ("oldInputIndex" + index);

    if (-1 < oiie.value)
    {
        var oldInput = list [oiie.value];

        var listener = meterListeners [index];
        var handler = meterErrorHandlers [index];

        oldInput.removeListener (listener);
        oldInput.removeErrorHandler (handler);
        oldInput.disconnect ();
    }

    var element = document.getElementById ("input" + index);

    var selection = element.selectedIndex;

    oiie.value = selection;

    var newInput = list [selection];

    addListener (index, newInput);
    addErrorHandler (index, newInput);

    newInput.connect ();

    captureMeter (index);
}

function meterMetricChange (index) {

    captureMeter (index);
}

function captureMeter (index) {

    var inputElement = document.getElementById ('input' + index);

    var input = inputElement.options [inputElement.selectedIndex].text;

    var metric = document.getElementById ('metric' + index).value;

    var meter = { 'input': input, 'metric': metric };

    var meters = LocalConfig.get ('meters');

    if (undefined === meters) {

        meters = [ meter ];

    } else {

        meters = JSON.parse (meters);

        if (index > meters.length) {

            meters.push (meter);

        } else {

            meters [index] = meter;
        }
    }

    LocalConfig.set ('meters', JSON.stringify (meters));
}

function createMeter (triggerInputChangeEvent)
{
    if (serverProbe)
    {
        var inputs = serverProbe.inputs;

        if (0 < inputs.length)
        {
            var meterArray = document.getElementById ("meterArray");

            var index = nextMeterIndex++;

            var table = document.createElement ("table");

            var row1 = table.insertRow (-1);
            row1.style.textAlign = "center";

            var cell1 = row1.insertCell (0);

            var innerInput = "<select onchange='meterInputChange ("
                + index + ")' id='input" + index + "'>";
            for (var i = 0; inputs.length > i; ++i)
            {
                var input = inputs [i];

                innerInput += "<option value='" + input.streamEndpoint
                    + "'>" + input.deviceName + " : "
                    + input.channelName + "</option>";
            }

            innerInput += "</select>";

            cell1.innerHTML = innerInput;

            var row2 = table.insertRow (-1);
            row2.style.textAlign = "center";

            var cell2 = row2.insertCell (0);

            cell2.id = "value" + index;
            cell2.innerHTML = "value";
            cell2.style.fontSize = "54px";

            var row3 = table.insertRow (-1);
            row3.style.textAlign = "center";

            var cell3 = row3.insertCell (0);

            var metrics = serverProbe.getMetrics ();

            var innerHTML = "<select onchange='meterMetricChange ("
                + index + ")' id='metric" + index + "'>";

            for (var i = 0; metrics.length > i; ++i)
            {
                innerHTML += "<option>" + metrics [i] + "</option>";
            }
            
            innerHTML += "</select>"
                + "<input type='hidden' id='oldInputIndex" + index
                + "' value='-1'/>";

            cell3.innerHTML = innerHTML;

            // allow the tables to line up one next to the other
            table.id = "table" + index;

            // create a container to float the close button over
            var container = document.createElement ("div");
            container.id = 'container' + index;
            container.style.cssFloat = 'left';
            container.style.position = 'relative';

            container.appendChild (table);

            if (meterArray.childElementCount) {

                var anchor = document.createElement ("a");
                anchor.id = 'close';
                anchor.href = 'javascript:closeMeter (' + index +');';
                anchor.innerHTML = "&times;";
                
                container.appendChild (anchor);
            }

            meterArray.appendChild (container);

            if (triggerInputChangeEvent)
            {
                var inputToTrigger = document.getElementById ('input' + index);

                inputToTrigger.dispatchEvent (new Event ('change'));
            }

            captureMeter (index);
        }
    }
}

function closeMeter (index)
{
    // disconnect from source
    var list = serverProbe.getStreamingInputs ();

    var oii = document.getElementById ("oldInputIndex" + index).value;

    var input = list [oii];

    var listener = meterListeners [index];
    var handler = meterErrorHandlers [index];

    input.removeListener (listener);
    input.removeErrorHandler (handler);

    delete meterListeners [index];
    delete meterErrorHandlers [index];

    input.disconnect ();

    // remove container from meterArray
    var table = document.getElementById ("table" + index);

    var container = table.parentNode;

    var meterArray = document.getElementById ("meterArray");

    console.assert (meterArray == container.parentNode);

    meterArray.removeChild (container);

    // capture state locally

    var meters = LocalConfig.get ('meters');

    if (undefined !== meters) {

        meters = JSON.parse (meters);

        if (index < meters.length) {

            meters.splice (index, 1);

            LocalConfig.set ('meters', JSON.stringify (meters));
        }
    }
}

function addListener (index, streamingInput)
{
    var listener = function (jsonObj) {

        var select = document.getElementById ("metric" + index);

        if (select)
        {
            var metrics = jsonObj.metrics;

            var count = metrics.length;

            var selectedMetric = select.value;

            for (var i = 0; count > i; ++i)
            {
                var metric = metrics [i];

                if (selectedMetric == Object.keys (metric) [0])
                {
                    var value = Object.values (metric) [0].toFixed (1);

                    var element = document.getElementById ("value" + index);

                    element.innerHTML = value;

                    var violation = metric.violation;

                    if (violation) {

                        var container = document.getElementById ('container'
                                + index);

                        container.style.backgroundColor = 'red';

                        setTimeout (function () {
                                
                                container.style.backgroundColor = ''; },
                                1000 / streamingInput.framerate / 2);
                    }

                    break;
                }
            }
        }
    };

    streamingInput.addListener (listener);

    meterListeners [index] = listener;
}

function addErrorHandler (index, streamingInput) {

    var handler = function () {

        var container = document.getElementById ('container' + index);

        if (container) {

            var anchor = document.createElement ("a");
            anchor.id = 'refresh' + index;
            anchor.href = 'javascript:refreshMeter (' + index +');';
            anchor.className = 'refresh';
            anchor.innerHTML = "↻";

            if (0 == index) {

                anchor.style.left = '10px';
            }

            container.appendChild (anchor);
        }

        var value = document.getElementById ('value' + index);

        if (value) {

            value.className = 'disabled';
        }
    }

    streamingInput.addErrorHandler (handler);

    meterErrorHandlers [index] = handler;
}

function refreshMeter (index) {

    // remove refresh anchor
    var anchor = document.getElementById ('refresh' + index);

    if (anchor) {

        var container = document.getElementById ('container' + index);

        container.removeChild (anchor);
    }

    var value = document.getElementById ('value' + index);

    if (value) {

        value.className = '';
    }

    var inputElement = document.getElementById ('input' + index);
    var inputToFind = inputElement.options [inputElement.selectedIndex].text;

    // this is crazy over-kill
    for (var i = 0; nextMeterIndex > i; ++i)
    {
        if (index != i) {

            var candidateElement = document.getElementById ('input' + i);

            if (candidateElement) {

                var options = candidateElement.options;
                var selection = options [candidateElement.selectedIndex];

                if (inputToFind == selection.text) {

                    var container = document.getElementById ('container' + i);
                    var refresh = document.getElementById ('refresh' + i);

                    container.removeChild (refresh);

                    var value = document.getElementById ('value' + i);

                    value.className = '';            
                }
            }
        }
    }

    meterInputChange (index);
}

function refreshPlot () {

    var button = document.getElementById ('refreshPlot');

    button.style.visibility = 'hidden';

    var count = plotData.length;
    for (var i = 0; count > i; ++i) {

        plotData [i].reconnect ();
    }
}

function onPlotInputChange ()
{
    reconcilePlotSources ();
}

function onPlotMetricChange ()
{
    reconcilePlotSources ();
}

function onPlotTimeWindowChange () {

    var timeWindow = document.getElementById ("plotDisplayLast").value;

    for (var i = 0; plotData.length > i; ++i) {

        plotData [i].setTimeWindow (timeWindow);
    }

    LocalConfig.set ('plotTimeWindow', timeWindow);

    updatePlot ();
}

function reconcilePlotSources () {

    // this needs to happen much earlier - onload will reference plotData?
    if (0 == plotData.length)
    {
        var timeWindow = document.getElementById ("plotDisplayLast").value;

        // could have the second metric selected without a first
        for (var i = 0; 2 > i; ++i)
        {
            var pd = new PlotData ();

            pd.setTimeWindow (timeWindow);

            pd.setErrorHandler (function () {

                        var button = document.getElementById ('refreshPlot');

                        button.style.visibility = 'visible';
                    });

            plotData.push (pd);
        }
    }

    var plotInputs = document.getElementById ('plotInputs');
    var currentIndex = plotInputs.selectedIndex;

    var lastIndexElement = document.getElementById ("lastPlotInput");
    var lastIndex = lastIndexElement.value;

    if (lastIndex != currentIndex)
    {
        for (var i = 0; plotData.length > i; ++i)
        {
            var data = plotData [i];

            data.disconnect ();
        }

        lastIndexElement.value = currentIndex;
    }

    LocalConfig.set ('plotInput', plotInputs.value);

    var plotMetrics = [];

    var inputs = serverProbe.inputs;

    var prefix = 'ws://' + serverProbe.host
        + inputs [currentIndex].logEndpoint + '/';

    plotAlarms = [];

    var alarms = inputs [currentIndex].alarms;

    if (alarms && alarms.length) {

        plotAlarms = JSON.parse (JSON.stringify (alarms));
    }

    var firstMetric = document.getElementById ('plotMetric0');

    if (firstMetric.value.length)
    {
        var data = plotData [0];

        if (data && data.metric != firstMetric.value)
        {
            data.setListener (updatePlot);

            var stream = prefix + firstMetric.value;

            // auto disconnects
            data.connect (firstMetric.value, stream);
        }

        plotMetrics.push (firstMetric.value);
    }
    else {

        plotData [0].disconnect ();
    }

    var secondMetric = document.getElementById ('plotMetric1');

    if (secondMetric.value.length)
    {
        var data = plotData [1];

        if (data && data.metric != secondMetric.value)
        {
            data.setListener (updatePlot);

            var stream = prefix + secondMetric.value;

            data.connect (secondMetric.value, stream);
        }

        plotMetrics.push (secondMetric.value);
    }
    else {

        plotData [1].disconnect ();
    }

    if (plotMetrics.length) {

        LocalConfig.set ('plotMetrics', JSON.stringify (plotMetrics));

    } else {

        LocalConfig.set ('plotMetrics', undefined);
    }
}

function resizeCanvas () {

    /** resize so scaling does not occur */

    var width = plotCanvas.width;
    var height = plotCanvas.height;

    var parent = plotCanvas.parentNode;

    var parentWidth = parent.clientWidth;
    var parentHeight = parent.clientHeight;

    if (parentWidth != width || parentHeight != height)
    {
        plotCanvas.width = parentWidth;
        plotCanvas.height = parentHeight;
    }
}

function renderPlotBackground () {

    var ctx = plotCanvas.getContext ('2d');

    var width = plotCanvas.width;
    var height = plotCanvas.height;

    /** start with a clean slate */

    ctx.clearRect (0, 0, width, height);

    /** draw a border around the plot area */
    ctx.strokeStyle = plotBorderColor;
    ctx.lineWidth = 2;
    ctx.beginPath ();
    ctx.moveTo (AxisWidth, 1);
    ctx.lineTo (AxisWidth, height - 1);
    ctx.lineTo (width - 1, height - 1);
    ctx.lineTo (width - 1, 1);
    ctx.lineTo (AxisWidth, 1);
    ctx.stroke ();

    /** draw the drid lines */

    ctx.strokeStyle = 'gray';
    ctx.lineWidth = 1;
    ctx.beginPath ();

    var gridlineYs = [];

    var sections = AxisLabelCount + 1;
    for (var i = 1; sections > i; ++i)
    {
        var y = i * height / 8;

        ctx.moveTo (AxisWidth, y);
        ctx.lineTo (width, y);

        gridlineYs.push (y);
    }

    ctx.stroke ();
}

function renderPlotAxisLabels (minY, dBperPixel) {

    var ctx = plotCanvas.getContext ('2d');

    var height = plotCanvas.height;

    var fontHeight = 13;
    ctx.fillStyle = plotBorderColor;
    ctx.textAlign = 'right';
    ctx.font = fontHeight.toString () + "px sans-serif";

    var halfHeight = fontHeight / 2;

    // if labels won't be unique, use decimal place to distinguish
    var scale = 1;
    if (1 > height / (AxisLabelCount + 1) * dBperPixel)
    {
        scale *= 10;
    }

    for (var i = 0; AxisLabelCount > i; ++i )
    {
        var y = (i + 1) * height / (AxisLabelCount + 1);

        var value = minY + (height - y) * dBperPixel;

        var rounded = Math.round (value * scale) / scale;

        ctx.fillText (rounded.toString (), AxisWidth - 4, y + halfHeight);
    }
}

function renderPlotMinuteMarkers (firstTime, lastTime) {

    var width = plotCanvas.width;
    var height = plotCanvas.height;

    var ctx = plotCanvas.getContext ('2d');

    var millisecondsPerPixel = (lastTime - firstTime) / (width - AxisWidth);
    var pixelsPerSecond = 60000 / millisecondsPerPixel;

    var minuteMark = AxisWidth + (60000 - (firstTime % 60000))
        / millisecondsPerPixel;

    while (width > minuteMark) {

        ctx.beginPath ();
        ctx.moveTo (minuteMark, 0);
        ctx.lineTo (minuteMark, height);
        ctx.stroke ();

        minuteMark += pixelsPerSecond;
    }
}

function renderPlotAlarms (minY, rangeY) {

    if (plotAlarms && plotAlarms.length) {

        var width = plotCanvas.width;
        var height = plotCanvas.height;

        var ctx = plotCanvas.getContext ('2d');

        ctx.strokeStyle = 'orange';
        ctx.lineWidth = 2;
        ctx.textAlign = 'left';

        var alarmCount = plotAlarms.length;
        for (var i = 0; alarmCount > i; ++i) {

            var alarm = plotAlarms [i];

            var label = alarm.level + " dB " + alarm.metric;

            var x = 2 * AxisWidth;

            var y = height - height * (alarm.level - minY) / rangeY;

            ctx.fillText (label, x, y);

            x += ctx.measureText (label).width + 10;

            ctx.beginPath ();
            ctx.moveTo (x, y);
            ctx.lineTo (width - 10, y);
            ctx.stroke ();
        }
    }
}

function renderPlotMetric (style, data) {

    var ctx = plotCanvas.getContext ('2d');

    ctx.strokeStyle = style;

    var startPath = true;
    var pathContainsPoints = false;

    var count = data.length;
    for (var i = 0; count > i; ++i)
    {
        var trip = data.shift ();

        if (trip.overload) {

            if (pathContainsPoints) {

                ctx.stroke ();
                pathContainsPoints = false;
            }

            startPath = true;

        } else {

            if (startPath) {

                if (pathContainsPoints) {

                    ctx.stroke ();
                    pathContainsPoints = false;
                }

                ctx.beginPath ();
                ctx.moveTo (trip.x, trip.y);

                startPath = false;

            } else {

                ctx.lineTo (trip.x, trip.y);
                pathContainsPoints = true;
            }
        }
    }

    ctx.stroke ();
}

function renderPlotOverloads (overloads) {

    var count = overloads.length;
    if (count) {

        var ctx = plotCanvas.getContext ('2d');
        var height = plotCanvas.height;

        ctx.strokeStyle = 'red';

        for (var i = 0; count > i; ++i)
        {
            var x = overloads [i];

            ctx.beginPath ();
            ctx.moveTo (x, 0);
            ctx.lineTo (x, height);
            ctx.stroke ();
        }
    }
}

function updatePlot () {

    /** get a copy of the data so the websocket thread doesn't clobber this */

    var data = Object.assign ([], plotData);

    if (data.length && (data [0].data.length || data [1].data.length))
    {
        var firstData = data [0];
        var secondData = data [1];

        firstData.purgeOldData (30);
        secondData.purgeOldData (30);

        var firstStartIndex = firstData.getTimeWindowStartIndex ();
        var secondStartIndex = secondData.getTimeWindowStartIndex ();

        var firstCount = firstData.size ();
        var secondCount = secondData.size ();

        var firstTime, lastTime;

        var waitForSecondStream = false;

        if (-1 < firstStartIndex) {

            firstTime = firstData.getTime (firstStartIndex);
            lastTime = firstData.getTime (firstCount - 1);

            if (-1 < secondStartIndex) {

                if (lastTime != secondData.getTime (secondCount - 1)) {
                    
                    waitForSecondStream = true;

                } else {

                    firstTime = Math.min (firstTime,
                            secondData.getTime (secondStartIndex));
                    lastTime = Math.max (lastTime,
                            secondData.getTime (secondCount - 1));
                }
            }

        } else if (-1 < secondStartIndex) {

            firstTime = secondData.getTime (secondStartIndex);
            lastTime = secondData.getTime (secondCount - 1);
        }

        if (false == waitForSecondStream) {

            var minY, rangeY;

            if (-1 < firstStartIndex) {

                var firstValueRange = firstData.getValueRange (firstStartIndex);

                minY = firstValueRange.min;
                rangeY = firstValueRange.max - minY;

                if (-1 < secondStartIndex) {

                    var secondValueRange
                        = secondData.getValueRange (secondStartIndex);

                    var maxY = Math.max (minY + rangeY, secondValueRange.max);

                    minY = Math.min (minY, secondValueRange.min);

                    rangeY = maxY - minY;
                }

            } else if (-1 < secondStartIndex) {

                var secondValueRange
                    = secondData.getValueRange (secondStartIndex);

                minY = secondValueRange.min;
                rangeY = secondValueRange.max - minY;
            }

            var ctx = plotCanvas.getContext ('2d');

            var width = plotCanvas.width;
            var height = plotCanvas.height;

            // bump the range a little to create a buffer on top & bottom
            var dBperPixel = rangeY / (height - 2 * PlotVerticalPadding);
            var dBpadding = PlotVerticalPadding * dBperPixel;

            minY -= dBpadding;
            rangeY += 2 * dBpadding;

            /** start with a clean slate */
            renderPlotBackground ();

            renderPlotAxisLabels (minY, dBperPixel);

            renderPlotMinuteMarkers (firstTime, lastTime);

            renderPlotAlarms (minY, rangeY);

            /** */
            var rangeX = lastTime - firstTime;

            // if a lot of data will be plotted, use a thinner line
            ctx.lineWidth = 2;

            var overloads = [];

            var extractPlotData = function (data, start, count) {

                var i = start;

                var toPlot = [];

                var lastX = 0, lastY, lastOverload;

                do {

                    var x = AxisWidth + (width - AxisWidth)
                        * (data.getTime (i) - firstTime) / rangeX;

                    var value = data.getValue (i);

                    var translated = value - minY;
                    var normalized = translated / rangeY;
                    var scaled = height * normalized;

                    var y = height - scaled;

                    if (lastX != x) {

                        if (lastX) {

                            toPlot.push (
                                    { x: lastX, y: lastY,
                                        overload: lastOverload });
                        
                            if (lastOverload) {

                                overloads.push (lastX);
                            }
                        }

                        lastX = x;
                        lastY = y;
                        lastOverload = data.isOverload (i);

                    } else {

                        // inverted, so use minimum
                        lastY = Math.min (lastY, y);

                        if (data.isOverload (i)) {

                            lastOverload = true;
                        }
                    }

                } while (count > ++i);

                return toPlot;
            };

            if (-1 < firstStartIndex) {

                var toPlot = extractPlotData (firstData, firstStartIndex,
                        firstCount);

                renderPlotMetric ('#009b05', toPlot);
            }

            if (-1 < secondStartIndex) {

                var toPlot = extractPlotData (secondData, secondStartIndex,
                        secondCount);

                renderPlotMetric ('#3264f5', toPlot);
            }

            renderPlotOverloads (overloads);
        }
    }
}

function initializeDefaultConfig (probe) {

    if (defaultConfig === undefined) {
        
        defaultConfig = {};
    }

    /** meter framerate */

    var validFramerates = [ 1, 2, 3, 4, 5, 6, 7, 8 ];

    if (false == defaultConfig.hasOwnProperty ('meterFramerate')
            || false == validFramerates.includes (defaultConfig.meterFramerate)) {

        defaultConfig.meterFramerate = 1;
    }

    /** settings which require an input */

    var inputs = probe.inputs;

    if (inputs && inputs.length) {

        var input = inputs [0];

        var defaultInput = input.deviceName + " : " + input.channelName;

        /** meters */

        if (false == defaultConfig.hasOwnProperty ('meters')) {

            defaultConfig.meters = [
                { 'input': defaultInput, 'metric': 'SPL A Slow' },
                { 'input': defaultInput, 'metric': 'SPL C Slow' },
                { 'input': defaultInput, 'metric': 'LAeq 1' },
                { 'input': defaultInput, 'metric': 'LAeq 10' }
            ];
        }

        /** plot input */

        if (false == defaultConfig.hasOwnProperty ('plotInput')) {

            defaultConfig.plotInput = defaultInput;
        }
    }

    /** plot metrics */

    if (false == defaultConfig.hasOwnProperty ('plotMetrics')) {

        defaultConfig.plotMetrics = [];
    }

    if (0 == defaultConfig.plotMetrics.length) {

        defaultConfig.plotMetrics.push ('SPL A Slow');
        defaultConfig.plotMetrics.push ('LAeq 1');

    } else if (1 == defaultConfig.plotMetrics.length) {

        var existing = defaultConfig.plotMetrics [0];

        if (-1 !== existing.indexOf ('SPL')) {

            defaultConfig.plotMetrics.push ('LAeq 1');

        } else {

            defaultConfig.plotMetrics.push ('SPL A Slow');
        }
    }

    /** plot time window */

    var validTimeWindows = [ 5, 10, 30 ];

    if (false == defaultConfig.hasOwnProperty ('plotTimeWindow')
            || false == validTimeWindows.includes (defaultConfig.plottimeWindow)) {

        defaultConfig.plotTimeWindow = 5;
    }
}

function applyLocalConfig () {

    // it is assumed that defaultConfig has been declared & initialized

    var meterFramerate = LocalConfig.get ('meterFramerate');

    if (undefined !== meterFramerate) {

        defaultConfig.meterFramerate = meterFramerate;
    }

    var meters = LocalConfig.get ('meters');

    if (undefined !== meters) {

        defaultConfig.meters = JSON.parse (meters);
    }

    var plotInput = LocalConfig.get ('plotInput');

    if (undefined !== plotInput) {

        defaultConfig.plotInput = plotInput;
    }

    var plotMetrics = LocalConfig.get ('plotMetrics');

    if (undefined !== plotMetrics) {

        defaultConfig.plotMetrics = JSON.parse (plotMetrics);
    }

    var plotTimeWindow = LocalConfig.get ('plotTimeWindow');

    if (undefined !== plotTimeWindow) {

        defaultConfig.plotTimeWindow = plotTimeWindow;
    }

    var theme = LocalConfig.get ('themePath');

    if (undefined !== theme) {

        applyTheme (theme);
    }
}

function setFramerate (framerate) {

    if (serverProbe) {

        serverProbe.setFramerate (framerate);

        LocalConfig.set ('meterFramerate', framerate);
    }
}

function lightColorScheme () {

  applyTheme ('css/light_theme.css');
}

function darkColorScheme () {

  applyTheme ('css/dark_theme.css');
}

function applyTheme (theme) {

  document.getElementById ('themeCss').setAttribute ('href', theme);

  LocalConfig.set ('themePath', theme);

  if (-1 !== theme.indexOf ('dark')) {

      plotBorderColor = 'white';

  } else {

      plotBorderColor = 'black';
  }

  updatePlot ();
}

function updateClock () {

    var now = new Date ();

    var time = now.getHours ().toString () + ":";

    var minutes = now.getMinutes ();

    if (10 > minutes) {

        time += "0";
    }

    time += now.getMinutes ().toString ();
    
    document.getElementById ('timeInput').value = time;
}

function onBodyLoad () {

    plotCanvas = document.getElementById ('history');

    resizeCanvas ();
    renderPlotBackground ();

    // this is async
    refreshStreams ();

    updateClock ();
}

function onBodyResize () {

    resizeCanvas ();
    updatePlot ();
}
