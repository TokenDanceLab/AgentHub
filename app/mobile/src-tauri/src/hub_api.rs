use serde::{Deserialize, Serialize};

const HUB_API_PREFIX: &str = "http://api.hub.vectorcontrol.tech/";

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HubRequest {
    method: String,
    url: String,
    body: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HubResponse {
    status: u16,
    body: String,
}

#[tauri::command]
pub async fn hub_request(request: HubRequest) -> Result<HubResponse, String> {
    if !request.url.starts_with(HUB_API_PREFIX) {
        return Err("Hub native bridge only allows TokenDance Hub API URLs.".into());
    }

    let method = request
        .method
        .parse()
        .map_err(|_| format!("Unsupported Hub request method: {}", request.method))?;

    let client = reqwest::Client::new();
    let mut builder = client
        .request(method, &request.url)
        .header(reqwest::header::CONTENT_TYPE, "application/json");

    if let Some(body) = request.body {
        builder = builder.body(body);
    }

    let response = builder
        .send()
        .await
        .map_err(|error| format!("Hub request failed: {error}"))?;
    let status = response.status().as_u16();
    let body = response
        .text()
        .await
        .map_err(|error| format!("Hub response read failed: {error}"))?;

    Ok(HubResponse { status, body })
}
