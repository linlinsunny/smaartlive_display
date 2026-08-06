import asyncio
import websockets
import json
import os

async def stream_smaart_data():
    # Remove proxy env vars just in case
    for var in ['http_proxy', 'https_proxy', 'all_proxy', 'HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY']:
        os.environ.pop(var, None)

    base_uri = "ws://127.0.0.1:26000"
    api_uri = f"{base_uri}/api/v3/"
    
    print(f"Connecting to main API: {api_uri}")
    stream_endpoint = None

    try:
        # Step 1: Connect to main API and find the stream endpoint
        async with websockets.connect(api_uri) as websocket:
            request_msg = {"action": "get", "target": "activeCalibratedInputs"}
            await websocket.send(json.dumps(request_msg))
            
            while True:
                response = await websocket.recv()
                try:
                    parsed = json.loads(response)
                    if "response" in parsed and "devices" in parsed["response"]:
                        devices = parsed["response"]["devices"]
                        if len(devices) > 0:
                            # Let's just grab the first available channel
                            first_device = devices[0]
                            channels = first_device.get("activeCalibratedChannels", [])
                            if len(channels) > 0:
                                stream_endpoint = channels[0].get("streamEndpoint")
                                print(f"Found Stream Endpoint: {stream_endpoint}")
                                break # Exit loop, we got what we need!
                        else:
                            print("Devices list is empty. Please enable SPL Logging in Smaart.")
                            return
                except json.JSONDecodeError:
                    pass

        # Step 2: If we found an endpoint, connect to it to get real-time SPL data!
        if stream_endpoint:
            full_stream_uri = f"{base_uri}{stream_endpoint}"
            print(f"\nConnecting to Data Stream: {full_stream_uri} ...")
            
            async with websockets.connect(full_stream_uri) as stream_ws:
                print("Stream connected! Requesting data at 2 FPS...\n")
                
                # Smaart requires us to set the target FPS to start receiving data
                set_fps_msg = {"action": "set", "properties": [{"targetFPS": 2}]}
                await stream_ws.send(json.dumps(set_fps_msg))
                
                while True:
                    data_response = await stream_ws.recv()
                    try:
                        stream_parsed = json.loads(data_response)
                        # Check if it has 'loggedData'
                        if "loggedData" in stream_parsed:
                            for data_point in stream_parsed["loggedData"]:
                                timestamp = data_point.get("timestamp")
                                value = data_point.get("value")
                                print(f"[{timestamp}] SPL: {value}")
                        else:
                            print(f"Server info: {stream_parsed}")
                    except json.JSONDecodeError:
                        pass

    except websockets.exceptions.ConnectionClosedError as e:
        print(f"Connection closed by server: {e}")
    except Exception as e:
        print(f"Error: {e}")

if __name__ == "__main__":
    try:
        asyncio.run(stream_smaart_data())
    except KeyboardInterrupt:
        print("\nStopped by user.")
