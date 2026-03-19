#!/bin/bash
set -e

echo "=============================="
echo "  Axentis Taxi - Auto Deploy  "
echo "=============================="

# 1. Обновление системы
echo "[1/6] Обновление системы..."
apt-get update -y
apt-get upgrade -y

# 2. Установка Docker и Docker Compose
echo "[2/6] Установка Docker..."
if ! command -v docker &> /dev/null; then
    apt-get install -y ca-certificates curl gnupg lsb-release
    install -m 0755 -d /etc/apt/keyrings
    curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
    chmod a+r /etc/apt/keyrings/docker.gpg
    echo \
      "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu \
      $(lsb_release -cs) stable" | tee /etc/apt/sources.list.d/docker.list > /dev/null
    apt-get update -y
    apt-get install -y docker-ce docker-ce-cli containerd.io
    systemctl enable docker
    systemctl start docker
    echo "Docker установлен!"
else
    echo "Docker уже установлен."
fi

# Устанавливаем docker-compose если недоступен
if ! command -v docker-compose &> /dev/null; then
    echo "Устанавливаем docker-compose..."
    curl -SL "https://github.com/docker/compose/releases/download/v2.24.0/docker-compose-linux-x86_64" -o /usr/local/bin/docker-compose
    chmod +x /usr/local/bin/docker-compose
    echo "docker-compose установлен!"
fi
COMPOSE_CMD="docker-compose"
echo "Используем: $COMPOSE_CMD"

# 3. Установка Git
echo "[3/6] Установка Git..."
apt-get install -y git

# 4. Клонирование репозитория
echo "[4/6] Клонирование репозитория..."
cd /opt
if [ -d "Axentis-taxi" ]; then
    echo "Репозиторий уже существует, обновляем..."
    cd Axentis-taxi
    git pull origin main
else
    git clone https://github.com/azamjonabdullaev001/Axentis-taxi.git
    cd Axentis-taxi
fi

# 5. Настройка firewall
echo "[5/6] Открытие портов..."
if command -v ufw &> /dev/null; then
    ufw allow 22/tcp    # SSH
    ufw allow 80/tcp    # HTTP
    ufw allow 8181/tcp  # Axentis Backend API
    ufw allow 3001/tcp  # Axentis Admin Panel
    ufw --force enable
fi

# 6. Запуск Docker Compose (отдельный project-name, не трогает старый проект)
echo "[6/6] Запуск приложения..."
export COMPOSE_PROJECT_NAME=axentis-taxi
$COMPOSE_CMD down 2>/dev/null || true
$COMPOSE_CMD up -d --build

echo ""
echo "=============================="
echo "  Деплой завершён успешно!   "
echo "=============================="
echo ""
echo "  Backend API:   http://109.123.253.238:8181"
echo "  Admin Panel:   http://109.123.253.238:3001"
echo ""
echo "Статус контейнеров Axentis Taxi:"
$COMPOSE_CMD ps
