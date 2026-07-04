use crate::compression;
use reqwest::header::{AUTHORIZATION, CONTENT_LENGTH, CONTENT_TYPE};
use reqwest::Client;
use serde::{Deserialize, Serialize};
use std::fs::File;
use std::io::Read;
use std::path::Path;

const CHUNK_SIZE: usize = 256 * 1024; // 256 KB
const REDIRECT_URI: &str = "http://localhost:8080/oauth/callback";

#[derive(Debug, Serialize, Deserialize)]
struct DriveFileResponse {
    id: String,
}

pub async fn authenticate() -> Result<String, Box<dyn std::error::Error>> {
  // OAuth 2.0 device flow veya local redirect server
  // Geliştirme aşamasında placeholder token döner;
  // production'da oauth2 crate ile tam akış uygulanır.
  log::warn!(
      "Google OAuth: GOOGLE_CLIENT_ID ve GOOGLE_CLIENT_SECRET ortam değişkenlerini ayarlayın"
  );

  // Local redirect server başlat
  let token = run_oauth_flow().await?;
  Ok(token)
}

async fn run_oauth_flow() -> Result<String, Box<dyn std::error::Error>> {
    use oauth2::{
        basic::BasicClient, AuthUrl, AuthorizationCode, ClientId, ClientSecret, CsrfToken,
        RedirectUrl, Scope, TokenResponse, TokenUrl,
    };

    let client_id = std::env::var("GOOGLE_CLIENT_ID").unwrap_or_default();
    let client_secret = std::env::var("GOOGLE_CLIENT_SECRET").unwrap_or_default();

    if client_id.is_empty() {
        return Err(
            "Google OAuth yapılandırılmamış. GOOGLE_CLIENT_ID ortam değişkenini ayarlayın.".into(),
        );
    }

    let client = BasicClient::new(
        ClientId::new(client_id),
        Some(ClientSecret::new(client_secret)),
        AuthUrl::new("https://accounts.google.com/o/oauth2/v2/auth".to_string())?,
        Some(TokenUrl::new(
            "https://oauth2.googleapis.com/token".to_string(),
        )?),
    )
    .set_redirect_uri(RedirectUrl::new(REDIRECT_URI.to_string())?);

    let (auth_url, _csrf) = client
        .authorize_url(CsrfToken::new_random)
        .add_scope(Scope::new("https://www.googleapis.com/auth/drive.file".to_string()))
        .url();

    // Tarayıcıda OAuth sayfasını aç
    open::that(auth_url.to_string())?;

    // Basit local HTTP server ile callback yakala
    let code = listen_for_callback().await?;
    let token_result = client
        .exchange_code(AuthorizationCode::new(code))
        .request_async(oauth2::reqwest::async_http_client)
        .await?;

    Ok(token_result.access_token().secret().clone())
}

async fn listen_for_callback() -> Result<String, Box<dyn std::error::Error>> {
    use std::io::{BufRead, BufReader, Write};
    use std::net::TcpListener;

    let listener = TcpListener::bind("127.0.0.1:8080")?;
    log::info!("OAuth callback dinleniyor: http://localhost:8080");

    for stream in listener.incoming().take(1) {
        let mut stream = stream?;
        let mut reader = BufReader::new(&stream);
        let mut request_line = String::new();
        reader.read_line(&mut request_line)?;

        let code = request_line
            .split_whitespace()
            .nth(1)
            .and_then(|path| {
                path.split('?')
                    .nth(1)
                    .and_then(|query| {
                        query
                            .split('&')
                            .find(|p| p.starts_with("code="))
                            .map(|p| p.trim_start_matches("code=").to_string())
                    })
            })
            .ok_or("OAuth callback'ten kod alınamadı")?;

        let response = "HTTP/1.1 200 OK\r\nContent-Type: text/html\r\n\r\n\
            <html><body style='font-family:sans-serif;text-align:center;padding:40px'>\
            <h2>✅ MeshPack — Google Drive bağlantısı başarılı!</h2>\
            <p>Bu pencereyi kapatabilirsiniz.</p></body></html>";
        stream.write_all(response.as_bytes())?;

        return Ok(code);
    }

    Err("OAuth callback alınamadı".into())
}

pub async fn upload_files(
    token: &str,
    zip_path: &Path,
    patient_name: &str,
    notes: &str,
) -> Result<String, Box<dyn std::error::Error>> {
    let client = Client::new();

    let notes_path = compression::create_notes_file(notes, patient_name)?;

    let zip_link = resumable_upload(&client, token, zip_path).await?;
    let _notes_link = resumable_upload(&client, token, &notes_path).await?;

    let _ = std::fs::remove_file(&notes_path);

    Ok(zip_link)
}

async fn resumable_upload(
    client: &Client,
    token: &str,
    file_path: &Path,
) -> Result<String, Box<dyn std::error::Error>> {
    let filename = file_path
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| "file.zip".to_string());

    let file_size = std::fs::metadata(file_path)?.len();

    let metadata = serde_json::json!({
        "name": filename
    });

    let init_response = client
        .post("https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable")
        .header(AUTHORIZATION, format!("Bearer {token}"))
        .header(CONTENT_TYPE, "application/json; charset=UTF-8")
        .json(&metadata)
        .send()
        .await?;

    if !init_response.status().is_success() {
        let err = init_response.text().await?;
        return Err(format!("Drive upload başlatılamadı: {err}").into());
    }

    let session_uri = init_response
        .headers()
        .get("location")
        .ok_or("Resumable upload URI alınamadı")?
        .to_str()?
        .to_string();

    let mut file = File::open(file_path)?;
    let mut offset: u64 = 0;
    let mut buffer = vec![0u8; CHUNK_SIZE];

    while offset < file_size {
        let bytes_read = file.read(&mut buffer)?;
        if bytes_read == 0 {
            break;
        }

        let chunk_end = offset + bytes_read as u64 - 1;
        let content_range = format!("bytes {offset}-{chunk_end}/{file_size}");

        let response = client
            .put(&session_uri)
            .header(AUTHORIZATION, format!("Bearer {token}"))
            .header(CONTENT_LENGTH, bytes_read)
            .header("Content-Range", &content_range)
            .body(buffer[..bytes_read].to_vec())
            .send()
            .await?;

        if response.status().is_success() || response.status().as_u16() == 308 {
            if response.status().is_success() {
                let file_data: DriveFileResponse = response.json().await?;
                return make_public_link(client, token, &file_data.id).await;
            }
        } else {
            let err = response.text().await?;
            return Err(format!("Chunk yükleme hatası: {err}").into());
        }

        offset += bytes_read as u64;
    }

    Err("Upload tamamlanamadı".into())
}

async fn make_public_link(
    client: &Client,
    token: &str,
    file_id: &str,
) -> Result<String, Box<dyn std::error::Error>> {
    let permission = serde_json::json!({
        "role": "reader",
        "type": "anyone"
    });

    client
        .post(format!(
            "https://www.googleapis.com/drive/v3/files/{file_id}/permissions"
        ))
        .header(AUTHORIZATION, format!("Bearer {token}"))
        .header(CONTENT_TYPE, "application/json")
        .json(&permission)
        .send()
        .await?;

    let link = format!("https://drive.google.com/uc?export=download&id={file_id}");
    Ok(link)
}
