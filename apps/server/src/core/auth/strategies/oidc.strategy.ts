import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy, Client, Issuer, TokenSet, UserinfoResponse } from 'openid-client';
import { EnvironmentService } from '../../../integrations/environment/environment.service';

export interface OidcProfile extends UserinfoResponse {
  email?: string;
  name?: string;
  given_name?: string;
  family_name?: string;
  preferred_username?: string;
}

@Injectable()
export class OidcStrategy extends PassportStrategy(Strategy, 'oidc') {
  private client: Client;

  constructor(private readonly environmentService: EnvironmentService) {
    // The client will be initialized lazily via getClient()
    super({} as any);
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
      this.client = new oidcIssuer.Client({
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uris: [redirectUri],
        response_types: ['code'],
      });

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
