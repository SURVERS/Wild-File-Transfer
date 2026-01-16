package main

import (
	"archive/zip"
	"crypto/rand"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/skip2/go-qrcode"
)

type FileEntry struct {
	Name string `json:"name"`
	Size int64  `json:"size"`
	URL  string `json:"url"`
}

type SessionData struct {
	ID        string      `json:"sessionId"`
	Files     []FileEntry `json:"files"`
	Text      string      `json:"text"`
	Ready     bool        `json:"ready"`
	Connected bool        `json:"connected"`

	// Новые поля для списка
	CreatedAt  time.Time `json:"createdAt"`
	DeviceName string    `json:"deviceName"` // Например: Windows Chrome
	DeviceType string    `json:"deviceType"` // Desktop / Mobile
}

var (
	sessionStore = struct {
		sync.RWMutex
		m map[string]*SessionData
	}{m: make(map[string]*SessionData)}
	uploadBaseDir string
	shareHost     = determineShareHost()
)

func main() {
	fmt.Println("[LOADING]: Идёт запуск сервера, пожалуйста подождите...")
	workDir, _ := os.Getwd()
	frontendDir := filepath.Join(workDir, "..", "frontend")
	uploadBaseDir = filepath.Join(workDir, "uploads")
	fmt.Println("[LOADING]: Идёт прочтение папок 'frontend' 'uploads'")
	os.MkdirAll(uploadBaseDir, 0o755)
	fmt.Println("[LOADING]: Идёт подготовка mux")

	mux := http.NewServeMux()
	mux.Handle("/files/", http.StripPrefix("/files/", http.FileServer(http.Dir(uploadBaseDir))))

	mux.HandleFunc("/get_qr_code", getQRCodeHandler)
	mux.HandleFunc("/send_files", sendFilesHandler)
	mux.HandleFunc("/session/", sessionStatusHandler)
	mux.HandleFunc("/connect", connectSessionHandler)
	mux.HandleFunc("/zip/", downloadZipHandler)
	mux.HandleFunc("/delete/", deleteSessionHandler)

	// НОВЫЙ: Получить список активных сессий
	mux.HandleFunc("/sessions", listSessionsHandler)

	mux.Handle("/", http.FileServer(http.Dir(frontendDir)))

	fmt.Printf("Wild File Transfer running on :8080 (host: %s)\n", shareHost)
	http.ListenAndServe(":8080", mux)
}

// Получение списка сессий (JSON)
func listSessionsHandler(w http.ResponseWriter, r *http.Request) {
	sessionStore.RLock()
	defer sessionStore.RUnlock()

	var activeSessions []SessionData
	for _, s := range sessionStore.m {
		// Показываем только те сессии, которые ждут файлы (Ready = false)
		if !s.Ready {
			activeSessions = append(activeSessions, *s)
		}
	}

	// Сортируем: новые сверху
	sort.Slice(activeSessions, func(i, j int) bool {
		return activeSessions[i].CreatedAt.After(activeSessions[j].CreatedAt)
	})

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(activeSessions)
}

func getQRCodeHandler(w http.ResponseWriter, r *http.Request) {
	sessionID := newSessionID()

	// Определяем устройство
	ua := r.UserAgent()
	devName, devType := parseUserAgent(ua)

	session := &SessionData{
		ID:         sessionID,
		CreatedAt:  time.Now(),
		DeviceName: devName,
		DeviceType: devType,
	}
	saveSession(session)

	shareURL := buildShareURL(sessionID)
	dataURL, _ := generateQRCode(shareURL)

	json.NewEncoder(w).Encode(map[string]string{
		"sessionId": sessionID,
		"shareUrl":  shareURL,
		"qrCodeUrl": dataURL,
	})
}

// Простой парсер User-Agent
func parseUserAgent(ua string) (string, string) {
	uaLower := strings.ToLower(ua)
	dtype := "Desktop"
	if strings.Contains(uaLower, "mobile") || strings.Contains(uaLower, "android") || strings.Contains(uaLower, "iphone") {
		dtype = "Mobile"
	}

	os := "Unknown OS"
	if strings.Contains(uaLower, "windows") {
		os = "Windows"
	}
	if strings.Contains(uaLower, "mac os") {
		os = "macOS"
	}
	if strings.Contains(uaLower, "android") {
		os = "Android"
	}
	if strings.Contains(uaLower, "linux") {
		os = "Linux"
	}
	if strings.Contains(uaLower, "iphone") || strings.Contains(uaLower, "ipad") {
		os = "iOS"
	}

	browser := "Browser"
	if strings.Contains(uaLower, "chrome") {
		browser = "Chrome"
	}
	if strings.Contains(uaLower, "firefox") {
		browser = "Firefox"
	}
	if strings.Contains(uaLower, "safari") && !strings.Contains(uaLower, "chrome") {
		browser = "Safari"
	}

	return fmt.Sprintf("%s / %s", os, browser), dtype
}

func connectSessionHandler(w http.ResponseWriter, r *http.Request) {
	id := r.URL.Query().Get("sessionId")
	if session, ok := getSession(id); ok {
		session.Connected = true
		saveSession(session)
		w.WriteHeader(http.StatusOK)
	} else {
		http.NotFound(w, r)
	}
}

func sendFilesHandler(w http.ResponseWriter, r *http.Request) {
	r.ParseMultipartForm(200 << 20)
	sessionID := r.FormValue("sessionId")
	session, ok := getSession(sessionID)
	if !ok {
		http.NotFound(w, r)
		return
	}
	text := r.FormValue("text")
	files := r.MultipartForm.File["files"]
	saved := make([]FileEntry, 0)
	if len(files) > 0 {
		sessionDir := filepath.Join(uploadBaseDir, sessionID)
		os.MkdirAll(sessionDir, 0o755)
		for _, fh := range files {
			dstPath := filepath.Join(sessionDir, fh.Filename)
			if _, err := os.Stat(dstPath); err == nil {
				dstPath = filepath.Join(sessionDir, fmt.Sprintf("%d_%s", time.Now().UnixNano(), fh.Filename))
			}
			src, _ := fh.Open()
			dst, _ := os.Create(dstPath)
			io.Copy(dst, src)
			dst.Close()
			src.Close()
			saved = append(saved, FileEntry{
				Name: fh.Filename,
				Size: fh.Size,
				URL:  "/files/" + sessionID + "/" + filepath.Base(dstPath),
			})
		}
	}
	session.Text = text
	session.Files = saved
	session.Ready = true
	saveSession(session)
	json.NewEncoder(w).Encode(map[string]interface{}{"status": "ok"})
}

func downloadZipHandler(w http.ResponseWriter, r *http.Request) {
	id := strings.TrimPrefix(r.URL.Path, "/zip/")
	sessionDir := filepath.Join(uploadBaseDir, id)
	if _, err := os.Stat(sessionDir); os.IsNotExist(err) {
		http.NotFound(w, r)
		return
	}
	w.Header().Set("Content-Type", "application/zip")
	w.Header().Set("Content-Disposition", fmt.Sprintf("attachment; filename=\"wild_transfer_%s.zip\"", id))
	zipWriter := zip.NewWriter(w)
	defer zipWriter.Close()
	files, _ := os.ReadDir(sessionDir)
	for _, file := range files {
		if file.IsDir() {
			continue
		}
		f, err := os.Open(filepath.Join(sessionDir, file.Name()))
		if err != nil {
			continue
		}
		wz, err := zipWriter.Create(file.Name())
		if err != nil {
			f.Close()
			continue
		}
		io.Copy(wz, f)
		f.Close()
	}
}

func deleteSessionHandler(w http.ResponseWriter, r *http.Request) {
	id := strings.TrimPrefix(r.URL.Path, "/delete/")
	sessionDir := filepath.Join(uploadBaseDir, id)
	os.RemoveAll(sessionDir)
	sessionStore.Lock()
	delete(sessionStore.m, id)
	sessionStore.Unlock()
	w.WriteHeader(http.StatusOK)
}

func sessionStatusHandler(w http.ResponseWriter, r *http.Request) {
	id := strings.TrimPrefix(r.URL.Path, "/session/")
	session, ok := getSession(id)
	if !ok {
		http.NotFound(w, r)
		return
	}
	json.NewEncoder(w).Encode(session)
}

func saveSession(s *SessionData) {
	sessionStore.Lock()
	defer sessionStore.Unlock()
	sessionStore.m[s.ID] = s
}

func getSession(id string) (*SessionData, bool) {
	sessionStore.RLock()
	defer sessionStore.RUnlock()
	s, ok := sessionStore.m[id]
	return s, ok
}

func generateQRCode(payload string) (string, error) {
	png, err := qrcode.Encode(payload, qrcode.Medium, 260)
	if err != nil {
		return "", err
	}
	return "data:image/png;base64," + base64.StdEncoding.EncodeToString(png), nil
}

func newSessionID() string {
	b := make([]byte, 4)
	rand.Read(b)
	return hex.EncodeToString(b)
}

func buildShareURL(session string) string {
	return fmt.Sprintf("http://%s:8080/?session=%s", shareHost, session)
}

func determineShareHost() string {
	if ip := getLocalIP(); ip != "" {
		return ip
	}
	return "localhost"
}

func getLocalIP() string {
	conn, err := net.Dial("udp", "8.8.8.8:80")
	if err != nil {
		return ""
	}
	defer conn.Close()
	return conn.LocalAddr().(*net.UDPAddr).IP.String()
}
