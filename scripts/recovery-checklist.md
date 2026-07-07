# Home Assistant Recovery Checklist

Use this as a short-run recovery checklist until main documentation is available.

- **Backup:** Create a tar of the HA data directory and copy off-device.
  - sudo tar -C /home/ubuntu -czf /home/ubuntu/homeassistant-backup-$(date -I).tgz homeassistant
- **Preserve DB:** If a `home-assistant_v2.db.bak*` exists, copy it to the live DB before starting HA.
  - sudo cp /home/ubuntu/homeassistant/home-assistant_v2.db.bak.* /home/ubuntu/homeassistant/home-assistant_v2.db
- **Permissions:** Ensure files are owned by UID 1000 (Home Assistant container user).
  - sudo chown -R 1000:1000 /home/ubuntu/homeassistant
- **Verify Compose / Bind:** Confirm compose or run command maps host dir to `/config`.
  - Correct bind: `-v /home/ubuntu/homeassistant:/config`
- **Start Clean:** Remove any mistaken container and start with correct mount and host networking.
  - sudo docker rm -f homeassistant
  - sudo docker run -d --name homeassistant --restart unless-stopped --privileged --network host -v /home/ubuntu/homeassistant:/config -v /etc/localtime:/etc/localtime:ro ghcr.io/home-assistant/home-assistant:stable
- **DNS Troubleshoot:** If cloud/timeouts occur, restart with explicit DNS flags.
  - sudo docker rm -f homeassistant
  - sudo docker run ... --dns 1.1.1.1 --dns 8.8.8.8 ...
- **Disable Custom Integrations:** If startup is noisy or failing, temporarily move custom components.
  - sudo mv /home/ubuntu/homeassistant/custom_components /home/ubuntu/homeassistant/custom_components.disabled
  - sudo docker restart homeassistant
- **Logs & Inspect:** Tail logs and confirm mounts if troubleshooting.
  - sudo docker logs homeassistant --tail 200 -f
  - sudo docker inspect --format '{{json .Mounts}}' homeassistant
- **Restore Steps If Needed:** If HA created a new default config by mistake, stop container, restore tar/DB, chown, then restart.

Keep this file as a short-term reference; replace with main docs when ready.
