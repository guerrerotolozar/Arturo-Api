#!/bin/bash
# ==========================================
# ARTURO SYSADMIN GUARD (Bash Sensor)
# ==========================================

LOG_FILE="/var/log/arturo_sysadmin.log"
API_URL="http://localhost:3000/api/sysadmin"

# Asegurar que el script se ejecuta como root
if [ "$EUID" -ne 0 ]; then
  echo "Por favor, corre este script como root o usando sudo"
  exit 1
fi

# ---------------------------------------------------------
# FASE 1: DEFENSA DEL DRIVER NVIDIA (Auto-Reparación)
# ---------------------------------------------------------
if ! command -v nvidia-smi &> /dev/null || ! nvidia-smi > /dev/null 2>&1; then
    echo "[$(date)] ⚠️ Driver NVIDIA caído. Purga iniciada." >> $LOG_FILE
    docker stop $(docker ps -q) 2>/dev/null
    
    apt-get remove --purge "^nvidia-.*" "^linux-modules-nvidia-.*" "^libnvidia-.*" -y
    apt-get autoremove -y
    
    # Busca dinámicamente la rama -open más alta
    LATEST_DRIVER=$(apt-cache pkgnames | grep -P '^nvidia-driver-\d+-open$' | sort -V | tail -n 1)
    
    if [ ! -z "$LATEST_DRIVER" ]; then
        apt-get install $LATEST_DRIVER -y
        curl -s -X POST "$API_URL/alerta-critica" -H "Content-Type: application/json" -d "{\"driver\": \"$LATEST_DRIVER\"}"
        shutdown -r +1
        exit 0
    fi
fi

# ---------------------------------------------------------
# FASE 2: CLASIFICADOR DE ACTUALIZACIONES
# ---------------------------------------------------------
export DEBIAN_FRONTEND=noninteractive
# apt-get update fue removido para no chocar con el "lock" del sistema
PENDING_UPDATES=$(apt-get -s upgrade | grep -E "^Inst ")

if [ -z "$PENDING_UPDATES" ]; then
    exit 0 # No hay actualizaciones
fi

if echo "$PENDING_UPDATES" | grep -qE "linux-image|linux-headers|nvidia-driver|libc6|systemd"; then
    # ========================================
    # ES PESADA (Requiere Reinicio)
    # ========================================
    curl -s -X POST "$API_URL/pesada" -H "Content-Type: application/json" -d "{\"paquetes_crudos\": \"$PENDING_UPDATES\"}"
else
    # ========================================
    # ES BARATA (Segura, en segundo plano)
    # ========================================
    apt-get upgrade -y -qq -o Dpkg::Options::="--force-confdef" -o Dpkg::Options::="--force-confold"
    curl -s -X POST "$API_URL/barata" -H "Content-Type: application/json" -d "{\"paquetes_crudos\": \"$PENDING_UPDATES\"}"
fi
