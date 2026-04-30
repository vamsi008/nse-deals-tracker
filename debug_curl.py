import subprocess
from nsepythonserver import curl_headers

url = "https://www.nseindia.com/api/historical/bulk-deals?from=18-04-2026&to=30-04-2026"
cmd = f"curl -v -b cookies.txt \"{url}\" {curl_headers}"
result = subprocess.run(cmd, shell=True, capture_output=True)
print("STDOUT:", result.stdout.decode('utf-8', 'ignore')[:500])
print("STDERR:", result.stderr.decode('utf-8', 'ignore')[:2000])
