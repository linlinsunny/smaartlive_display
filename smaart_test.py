import asyncio
import websockets
import json
import os

async def test_smaart():
    # Remove proxy env vars just in case they interfere with localhost connections
    for var in ['http_proxy', 'https_proxy', 'all_proxy', 'HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY']:
        os.environ.pop(var, None)

    uri = "ws://127.0.0.1:26000/api/v3/"
    print(f"Connecting to {uri}...")
    
    try:
        async with websockets.connect(uri) as websocket:
            print("Connected successfully!\n")
            
            # Request active calibrated inputs
            request_msg = {"action": "get", "target": "activeCalibratedInputs"}
            print(f"Sending request: {json.dumps(request_msg)}")
            await websocket.send(json.dumps(request_msg))
            
            print("Waiting for response (press Ctrl+C to stop)...")
            while True:
                response = await websocket.recv()
                print("\n--- Received Message ---")
                
                # Try to parse and pretty-print JSON
                try:
                    parsed = json.loads(response)
                    print(json.dumps(parsed, indent=4))
                    
                    # If we got devices, Smaart SPL JS typically connects to the channel's streamEndpoint
                    # Here we just inform the user what the next step would be if devices aren't empty
                    if "response" in parsed and "devices" in parsed["response"]:
                        devices = parsed["response"]["devices"]
                        if len(devices) > 0:
                            print("\n[SUCCESS] Found active calibrated devices!")
                            for device in devices:
                                for channel in device.get("activeCalibratedChannels", []):
                                    print(f" -> Device: {device.get('deviceName')} | Channel: {channel.get('channelName')}")
                                    print(f" -> Stream Endpoint: {channel.get('streamEndpoint')}")
                        else:
                            print("\n[WARNING] Devices list is empty. You need to calibrate the input and start SPL logging in Smaart.")
                except json.JSONDecodeError:
                    print(response)

    except websockets.exceptions.ConnectionClosedError as e:
        print(f"Connection closed by server: {e}")
    except ConnectionRefusedError:
        print("Connection refused. Is Smaart running and API enabled on port 26000?")
    except Exception as e:
        print(f"Error: {e}")

if __name__ == "__main__":
    try:
        asyncio.run(test_smaart())
    except KeyboardInterrupt:
        print("\nStopped by user.")
