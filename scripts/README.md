# Scripts for Cognito Operation

## AWS CLIで自己サインアップからSMS MFAログインまで試す

前提:

- AWS CLI v2を設定済みであること（`aws configure` または適切なプロファイル）。
- `src/lib/main-stack.ts` をデプロイ済みであること。
- 下記の `UserPoolId` と `ClientId` は、CDKのOutputsに表示された値を設定する。
- `Phone` はE.164形式（例: `+819012345678`）の、SMSを受信できる番号にする。SMS sandbox中は、AWS End User Messaging SMS/SNSで宛先の検証が必要になる場合がある。
- メールアドレスと電話番号の確認コード、およびMFAコードを受信できること。

このスタックのデフォルトコンテキスト（`systemName=CognitoTest`, `stage=dev`）では、CloudFormation Export名は `CognitoTest-dev-UserPoolId` と `CognitoTest-dev-AppClientId` になる。Exportから取得する場合は次を実行する。

```powershell
$Region = "ap-northeast-1"
$UserPoolId = aws cloudformation list-exports --region $Region --query "Exports[?Name=='CognitoTest-dev-UserPoolId'].Value | [0]" --output text
$ClientId = aws cloudformation list-exports --region $Region --query "Exports[?Name=='CognitoTest-dev-AppClientId'].Value | [0]" --output text
```

既存の別ステージを使う場合は、Outputsに表示された値を直接設定する。

```powershell
$Region = "ap-northeast-1"
$UserPoolId = "<UserPoolId>"
$ClientId = "<AppClientId>"
```

### 1. 自己サインアップ

パスワードはコードや履歴に残さないため、環境変数に設定してから実行する。パスワードは8文字以上で、大文字・小文字・数字・記号をそれぞれ含める必要がある。

```powershell
$Username = "cognito-cli-$(Get-Random)"
$Email = "<受信可能なメールアドレス>"
$Phone = "+819012345678"
$Password = Read-Host "Cognito password" -AsSecureString
$PasswordPlain = [System.Net.NetworkCredential]::new("", $Password).Password

$SignUp = aws cognito-idp sign-up `
  --region $Region `
  --client-id $ClientId `
  --username $Username `
  --password $PasswordPlain `
  --user-attributes "Name=email,Value=$Email" "Name=phone_number,Value=$Phone" `
  --output json | ConvertFrom-Json

$SignUp | Format-List
```

`autoVerify.email` と `autoVerify.phone` が有効でも、ユーザー確認コードの入力が必要になる場合がある。`CodeDeliveryDetails` を確認し、メールまたはSMSで届いたコードを使って確認する。

```powershell
$ConfirmationCode = Read-Host "Sign-up confirmation code"
aws cognito-idp confirm-sign-up `
  --region $Region `
  --client-id $ClientId `
  --username $Username `
  --confirmation-code $ConfirmationCode
```

### 2. MFA有効化前のサインイン

`userPassword` が有効なため、`USER_PASSWORD_AUTH` を使用する。ここで得たアクセストークンを、ユーザー自身のMFA設定に使用する。

```powershell
$AuthParameters = @{ USERNAME = $Username; PASSWORD = $PasswordPlain } | ConvertTo-Json -Compress
$Auth = aws cognito-idp initiate-auth `
  --region $Region `
  --client-id $ClientId `
  --auth-flow USER_PASSWORD_AUTH `
  --auth-parameters $AuthParameters `
  --output json | ConvertFrom-Json

$AccessToken = $Auth.AuthenticationResult.AccessToken
if (-not $AccessToken) {
  throw "初回サインインが完了しませんでした。ChallengeName=$($Auth.ChallengeName)"
}
```

### 3. SMS MFAを有効化

SMSを有効かつ優先MFAに設定する。

```powershell
aws cognito-idp set-user-mfa-preference `
  --region $Region `
  --access-token $AccessToken `
  --sms-mfa-settings Enabled=true,PreferredMfa=true
```

設定確認:

```powershell
aws cognito-idp get-user --region $Region --access-token $AccessToken
```

### 4. SMS MFAを使ったサインイン

再度パスワード認証を開始すると、SMSにMFAコードが届く。`SMS_MFA` チャレンジのセッションを使って応答する。

```powershell
$AuthParameters = @{ USERNAME = $Username; PASSWORD = $PasswordPlain } | ConvertTo-Json -Compress
$MfaAuth = aws cognito-idp initiate-auth `
  --region $Region `
  --client-id $ClientId `
  --auth-flow USER_PASSWORD_AUTH `
  --auth-parameters $AuthParameters `
  --output json | ConvertFrom-Json

if ($MfaAuth.ChallengeName -ne "SMS_MFA") {
  throw "想定したSMS_MFAではありません。ChallengeName=$($MfaAuth.ChallengeName)"
}

$MfaCode = Read-Host "SMS MFA code"
$Tokens = aws cognito-idp respond-to-auth-challenge `
  --region $Region `
  --client-id $ClientId `
  --challenge-name SMS_MFA `
  --session $MfaAuth.Session `
  --challenge-responses "USERNAME=$Username,SMS_MFA_CODE=$MfaCode" `
  --output json | ConvertFrom-Json

$Tokens.AuthenticationResult | Format-List
```

`AuthenticationResult` にアクセストークン・IDトークン・リフレッシュトークンが表示されれば、SMS MFAによるサインイン完了である。コードが届かない場合は、電話番号の形式、Cognito/SNSのSMS権限、SMS sandboxの宛先検証、リージョンを確認する。
