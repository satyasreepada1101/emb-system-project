from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import os


HOST = "127.0.0.1"
PORT = 8000
WEB_ROOT = Path(__file__).resolve().parent


class RadarRequestHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(WEB_ROOT), **kwargs)

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()


if __name__ == "__main__":
    os.chdir(WEB_ROOT)
    server = ThreadingHTTPServer((HOST, PORT), RadarRequestHandler)
    print(f"Sound Radar is running at http://localhost:{PORT}")
    print("Press Ctrl+C to stop the server.")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopping Sound Radar.")
    finally:
        server.server_close()
