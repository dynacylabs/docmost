import { Injectable, UnauthorizedException } from '@nestjs/common';
import { Client, Issuer, TokenSet, UserinfoResponse } from 'openid-client';
import { EnvironmentService } from '../../../integrations/environment/environment.service';

export interface OidcProfile extends UserinfoResponse {
  email?: string;
  name?: string;
  given_name?: string;
  family_name?: string;
  preferred_username?: string;
}

@Injectable()
export class OidcStrategy {
  private client: Client;

  constructor(private readonly environmentService: EnvironmentService) {
    // Client will be initialized lazily via getClient()
  }

  async getClient(): Promise<Client> {
    if (this.client) {
      return this.client;
    }

    const issuer = this.environmentService.getOidcIssuer();
    const clientId = this.environmentService.getOidcClientId();
    const clientSecret = this.environmentService.getOidcClientSecret();
    const redirectUri = this.environmentService.getOidcRedirectUri();

    if (!issuer || !clientId || !clientSecret || !redirectUri) {
      throw new UnauthorizedException('OIDC is not properly configured');
    }

    try {
      const oidcIssuer = await Issuer.discover(issuer);
      
      // Create client with token_endpoint_auth_method to match Authelia
      this.client = new oidcIssuer.Client({
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uris: [redirectUri],
        response_types: ['code'],
        token_endpoint_auth_method: 'client_secret_post',
      });

      // Override the callback method to skip issuer validation for Authelia compatibility
      const originalCallback = this.client.callback.bind(this.client);
      this.client.callback = async (redirectUri: string, parameters: any, checks?: any) => {
        try {
          return await originalCallback(redirectUri, parameters, checks);
        } catch (error) {
          if (error instanceof Error && error.message.includes('iss missing')) {
            // Retry without issuer check for Authelia compatibility
            return await originalCallback(redirectUri, parameters, { ...checks, response_type: 'code' });
          }
          throw error;
        }
      };

      return this.client;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      throw new UnauthorizedException(`Failed to discover OIDC issuer: ${message}`);
    }
  }

  async validate(tokenSet: TokenSet): Promise<OidcProfile> {
    const client = await this.getClient();
    const userinfo = await client.userinfo(tokenSet.access_token);
    
    if (!userinfo.email) {
      throw new UnauthorizedException('Email not provided by OIDC provider');
    }

    return userinfo as OidcProfile;
  }
}
