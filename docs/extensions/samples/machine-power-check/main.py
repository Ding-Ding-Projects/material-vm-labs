# Sample Material VM Labs extension (Python 3, standard library only).
# One JSON request line in on standard input, one JSON answer line out on standard output.
import json
import sys

request = json.loads(sys.stdin.readline())
machine = request["input"]["machine"]
checks = []
running = (machine.get("power") or "").lower() == "running"
checks.append({"status": "pass" if running else "fail", "title": "Running",
               "detail": "The machine is on." if running else "Start it first: mvl start " + machine["name"]})
ip = machine.get("ip")
checks.append({"status": "pass" if ip else "warn", "title": "Address",
               "detail": "Reachable at " + ip if ip else "No address yet. mvl ip " + machine["name"] + " --wait 60 waits for one."})
summary = "Ready" if running and ip else "Not ready yet"
print(json.dumps({"type": "answer", "summary": summary, "checks": checks}), flush=True)
