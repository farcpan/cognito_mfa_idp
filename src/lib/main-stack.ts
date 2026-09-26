import { Construct } from "constructs";
import { CfnOutput, RemovalPolicy, Stack, StackProps } from "aws-cdk-lib";
import { 
    AccountRecovery, 
    Mfa, 
    UserPool, 
    UserPoolClient,
    UserPoolClientIdentityProvider,
    UserPoolEmail,
} from "aws-cdk-lib/aws-cognito";
import { ContextParameters } from "../utils/context";

interface MainStackProps extends StackProps {
    context: ContextParameters;
}

export class MainStack extends Stack {
    public readonly userPool: UserPool;
    public readonly appClient: UserPoolClient;
    //public readonly ssoClient: UserPoolClient;

    constructor(scope: Construct, id: string, props: MainStackProps) {
        super(scope, id, props);

        /////////////////////////////////////////////////////////////////////////////////////////////
        // Cognito setup
        /////////////////////////////////////////////////////////////////////////////////////////////
        const userPoolName = props.context.getResourceId("user-pool");
        this.userPool = new UserPool(this, userPoolName, {
            userPoolName: userPoolName,
            signInAliases: {
                username: true,
                email: true,    // メールアドレスによるログインを許可
            },
            // メールアドレスを大文字・小文字を区別せず扱う
            signInCaseSensitive: false,
            standardAttributes: {
                email: {
                    required: true,
                    mutable: true,
                },
                phoneNumber: {
                    required: false,    // 電話番号は登録必須とはしないが、MFAには必要
                    mutable: true,
                },
            },
            autoVerify: {
                email: true,
                phone: false,
            },
            mfa: Mfa.OPTIONAL,  // MFAは必須ではない
            mfaSecondFactor: {
                sms: true,  // MFA手段はSMS
                otp: false,
            },
            selfSignUpEnabled: true,    // 自己サインアップを許可
            passwordPolicy: {
                minLength: 8,
                requireLowercase: true,
                requireUppercase: true,
                requireDigits: true,
                requireSymbols: true,
            },
            // パスワードリセットにはメールアドレスを利用する
            // SMSはMFAに利用。手段を分ける必要がある（Cognitoの制約）
            accountRecovery: AccountRecovery.EMAIL_ONLY,
            // Cognitoからのメール配信
            email: UserPoolEmail.withCognito(),
            // SMS MFAを使用するため、CDKにSMS用IAM Roleを作成させる
            enableSmsRole: true,

            // 削除ポリシー
            removalPolicy: RemovalPolicy.DESTROY
        });

        // 通常ログイン用のクライアント
        const appClientName = "app-client";
        this.appClient = this.userPool.addClient(props.context.getResourceId(appClientName), {
            userPoolClientName: appClientName,
            generateSecret: false,
            authFlows: {
                userPassword: true,
                userSrp: true,
            },
            // 将来のIdP連携を考慮して、
            // 現時点ではCognito User Pool自身による認証のみ
            supportedIdentityProviders: [
                UserPoolClientIdentityProvider.COGNITO,
            ],
            preventUserExistenceErrors: true,
            enableTokenRevocation: true,
        });

        // @FIXME 将来的にIdP連携する場合は新しいクライアントを追加する


        // Outputs
        const userPoolIdOutputName = props.context.getResourceId("UserPoolId");
        new CfnOutput(this, userPoolIdOutputName, {
            exportName: userPoolIdOutputName,
            value: this.userPool.userPoolId,
        });
        const appClientIdOutputName = props.context.getResourceId("AppClientId");
        new CfnOutput(this, appClientIdOutputName, {
            exportName: appClientIdOutputName,
            value: this.appClient.userPoolClientId,
        });
    }
}
