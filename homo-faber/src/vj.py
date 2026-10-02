# Hilfsskript: Higgsfield-Ergebnis herunterladen und im Job-Protokoll vermerken.  python3 vj.py IDX JOB_ID URL
import json, sys, subprocess
i, job, url = sys.argv[1:4]
L = json.load(open('voice_jobs_en.json'))
L['jobs'][i] = {'job_id': job, 'url': url}
json.dump(L, open('voice_jobs_en.json', 'w'), indent=1)
f = f'voice_raw/en_{int(i):02d}.mp3'
subprocess.run(['curl', '-sS', '-m', '120', '-o', f, url], check=True)
d = subprocess.check_output(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', f]).decode().strip()
print(i, f, d, 's')
