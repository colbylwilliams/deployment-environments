import * as core from '@actions/core';
import * as exec from '@actions/exec';
import * as github from '@actions/github';
import * as glob from '@actions/glob';
import * as io from '@actions/io';
import * as fs from 'fs/promises';
import * as yaml from 'js-yaml';
import { Configuration, ConfigurationFile, Environment, EnvironmentConfig } from './types';

export async function run(): Promise<void> {
    const envCmd = ['devcenter', 'dev', 'environment'];

    try {
        const az = await io.which('az', true);
        core.debug(`az cli path: ${az}`);

        const config = await getConfiguration(az);

        core.setOutput('name', config.environmentName);
        core.setOutput('type', config.environmentType);

        if (config.action === 'setup') {
            return;
        }

        core.setOutput('tenant', config.tenant);

        core.info('Installing Azure CLI DevCenter extension');
        await exec.exec(az, ['extension', 'add', '--name', 'devcenter', '--upgrade']);

        const envArgs = [
            '--only-show-errors',
            '--dev-center',
            config.devcenter,
            '--project',
            config.project,
            '--name',
            config.environmentName
        ];

        const mutateArgs = [
            '--environment-type',
            config.environmentType,
            '--catalog-name',
            config.catalog,
            '--catalog-item-name',
            config.catalogItem
        ];

        let exists = false;
        let created = false;
        let environment: Environment | undefined;

        if (config.parameters) mutateArgs.push('--parameters', config.parameters);

        const show = await exec.getExecOutput(az, [...envCmd, 'show', ...envArgs], { ignoreReturnCode: true });
        exists = show.exitCode === 0;

        if (exists) {
            core.info('Found existing environment');
            environment = JSON.parse(show.stdout) as Environment;

            if (config.action === 'update') {
                core.info('Action is update, attempting to update environment');
                const update = await exec.getExecOutput(az, [...envCmd, 'update', ...envArgs, ...mutateArgs], {
                    ignoreReturnCode: true
                });
                if (update.exitCode === 0) {
                    core.info('Updated environment');
                    environment = JSON.parse(update.stdout) as Environment;
                } else {
                    throw Error(`Failed to update environment: ${update.stderr}`);
                }
            } else if (config.action === 'delete') {
                core.info('Action is delete, attempting to delete environment');
                const del = await exec.getExecOutput(az, [...envCmd, 'delete', ...envArgs], { ignoreReturnCode: true });
                if (del.exitCode === 0) {
                    core.info('Deleted environment');
                    // environment = undefined;
                } else {
                    throw Error(`Failed to delete environment: ${del.stderr}`);
                }
            }
        } else if (config.action === 'create' || config.action === 'ensure') {
            core.info(`Action is ${config.action}, attempting to create environment`);

            const create = await exec.getExecOutput(az, [...envCmd, 'create', ...envArgs, ...mutateArgs], {
                ignoreReturnCode: true
            });

            exists = created = create.exitCode === 0;

            if (created) {
                core.info('Created environment');
                environment = JSON.parse(create.stdout) as Environment;
            } else {
                throw Error(`Failed to create environment: ${create.stderr}`);
            }
        } else {
            core.info(`No existing environment found: code: ${show.exitCode}`);
        }

        if (environment) {
            const groupId = environment.resourceGroupId;

            const resourceGroupKey = groupId.includes('/resourceGroups/') ? '/resourceGroups/' : '/resourcegroups/';

            const group = groupId.split(resourceGroupKey)[1].split('/')[0];
            const subscription = groupId.split('/subscriptions/')[1].split('/')[0];
            const portalUrl = `https://portal.azure.com/#@${config.tenant}/resource${groupId}`;

            core.setOutput('tenant', config.tenant);
            core.setOutput('subscription', subscription);
            core.setOutput('resource-group', group);
            core.setOutput('resource-group-id', groupId);
            core.setOutput('portal-url', portalUrl);
        }

        core.setOutput('exists', exists);
        core.setOutput('created', created);
    } catch (error) {
        if (error instanceof Error) core.setFailed(error.message);
    }
}

async function getConfiguration(az: string): Promise<Configuration> {
    const config: Configuration = {} as Configuration;
    const actions = ['setup', 'get', 'create', 'update', 'ensure', 'delete'];

    config.action = (core.getInput('action', { required: false }) || 'setup').toLowerCase();
    if (!actions.includes(config.action))
        throw Error(`Invalid action: ${config.action}. Must be one of: ${actions.join(', ')}`);

    const file = await getConfigurationFile();

    config.prefix = core.getInput('prefix', { required: false }) || file?.prefix || 'ci';
    config.suffix =
        core.getInput('suffix', { required: false }) || file?.suffix || process.env['GITHUB_REPOSITORY_ID']!;

    config.devBranch = core.getInput('dev-branch', { required: false }) || file?.['dev-branch'] || '';
    config.mainBranch = core.getInput('main-branch', { required: false }) || file?.['main-branch'] || 'main';

    config.prodEnvironmentName =
        core.getInput('prod-environment-name', { required: false }) || file?.['prod-environment-name'] || '';

    config.prodEnvironmentType =
        core.getInput('prod-environment-type', { required: false }) || file?.['prod-environment-type'] || 'Prod';

    config.stagingEnvironmentType =
        core.getInput('staging-environment-type', { required: false }) ||
        file?.['staging-environment-type'] ||
        'Staging';

    config.testEnvironmentType =
        core.getInput('test-environment-type', { required: false }) || file?.['test-environment-type'] || 'Test';

    config.devEnvironmentType =
        core.getInput('dev-environment-type', { required: false }) || file?.['dev-environment-type'] || 'Dev';

    const setup = getEnvironmentConfig(config);

    config.environmentName = setup.name;
    config.environmentType = setup.type;

    if (config.action !== 'setup') {
        config.tenant = core.getInput('tenant', { required: false }) || file?.tenant || (await getTenant(az, config));

        config.subscription =
            core.getInput('subscription', { required: false }) ||
            file?.subscription ||
            (await getSubscription(az, config));

        config.devcenter = core.getInput('devcenter', { required: false }) || file?.devcenter || '';
        if (!config.devcenter) throw Error('Must provide a value for devcenter as action input or in config file.');

        config.project = core.getInput('project', { required: false }) || file?.project || '';
        if (!config.project) throw Error('Must provide a value for project as action input or in config file.');

        if (config.action === 'create' || config.action === 'update' || config.action === 'ensure') {
            config.catalog = core.getInput('catalog', { required: false }) || file?.catalog || '';
            if (!config.catalog) throw Error('Must provide a value for catalog as action input or in config file.');

            config.catalogItem = core.getInput('catalog-item', { required: false }) || file?.['catalog-item'] || '';
            if (!config.catalogItem)
                throw Error('Must provide a value for catalog-item as action input or in config file.');

            config.parameters = core.getInput('parameters', { required: false }) || file?.parameters || '';
        }
    }

    core.info('Configuration:');
    core.info(`Configuration:${JSON.stringify(config)}`);

    return config;
}

async function getConfigurationFile(): Promise<ConfigurationFile | undefined> {
    const defaultPattern = 'ade.yml';
    const pattern = core.getInput('config', { required: false }) || defaultPattern;

    const isDefault = pattern === defaultPattern;
    const defaultText = isDefault ? ' (default)' : '';
    core.info(`Found input config: ${pattern}${defaultText}`);

    const globber = await glob.create(pattern);
    const files = await globber.glob();

    const file = files.length > 0 ? files[0] : undefined;

    if (!file) {
        core.info('No cofiguration file found, skipping');
        if (!isDefault) core.warning(`Could not find configuration file at path: ${pattern}`);
        return undefined;
    }

    core.info(`Found configuration file: ${file}`);

    const contents = await fs.readFile(file, 'utf8');
    const config = yaml.load(contents) as ConfigurationFile;

    return config;
}

function getEnvironmentConfig(config: Configuration): EnvironmentConfig {
    const context = github.context;

    const { eventName } = context;

    if (eventName != 'push' && eventName != 'pull_request' && eventName != 'create' && eventName != 'delete')
        throw new Error(`Unsupported event type: ${eventName}`);

    const isPr: boolean = eventName == 'pull_request';
    const refType: string = isPr ? 'pr' : 'branch';

    const refName: string = isPr
        ? context.payload.pull_request!.number.toString() // PR number
        : context.ref.replace('refs/heads/', ''); // Branch name
    if (!refName) throw new Error(`Failed to get branch name or pr number from context`);

    const setup: EnvironmentConfig = {} as EnvironmentConfig;

    if (isPr) {
        setup.type =
            context.payload.pull_request!['base']['ref'] == config.mainBranch && config.devBranch
                ? config.stagingEnvironmentType
                : config.testEnvironmentType;
    } else {
        setup.type = refName == config.mainBranch ? config.prodEnvironmentType : config.devEnvironmentType;
    }

    core.info(`Resolved environment type: ${setup.type}`);

    if (config.prodEnvironmentName && config.environmentType == config.prodEnvironmentType) {
        core.info(`Using prod environment name override: ${config.prodEnvironmentName}`);
        setup.name = config.prodEnvironmentName;
    } else {
        setup.name = `${config.prefix}-${refType}-${refName}-${config.suffix}`;
    }

    core.info(`Resolved environment name: ${setup.name}`);

    return setup;
}

async function getTenant(az: string, config?: ConfigurationFile): Promise<string> {
    let tenant: string = core.getInput('tenant', { required: false });

    if (tenant) {
        core.info(`Found input tenant: ${tenant}`);
        return tenant;
    }

    if (config?.tenant) {
        core.info(`Found tenant in configuration file: ${config.tenant}`);
        return config.tenant;
    }

    core.info('Input tenant is not set, attempting to get it from the azure cli');
    const tenantCmd = ['account', 'show', '--query', 'tenantId', '--output', 'tsv'];

    const tenantId = await exec.getExecOutput(az, tenantCmd);

    if (!tenantId.stdout) throw new Error(`Failed to get tenant id from Azure: ${tenantId.stderr}`);

    tenant = tenantId.stdout.trim();
    core.info(`Found tenant: ${tenant}`);

    return tenant;
}

async function getSubscription(az: string, config?: ConfigurationFile): Promise<string> {
    let subscription: string = core.getInput('subscription', { required: false });

    if (subscription) {
        core.info(`Found input subscription: ${subscription}`);
        return subscription.replace('/', '').replace('subscriptions', '');
    }

    if (config?.subscription) {
        core.info(`Found subscription in configuration file: ${config.subscription}`);
        return config.subscription.replace('/', '').replace('subscriptions', '');
    }

    core.info('Input subscription is not set, attempting to get it from the azure cli');
    const subscriptionCmd = ['account', 'show', '--query', 'id', '--output', 'tsv'];

    const subscriptionId = await exec.getExecOutput(az, subscriptionCmd);

    if (!subscriptionId.stdout) throw new Error(`Failed to get subscription id from Azure: ${subscriptionId.stderr}`);

    subscription = subscriptionId.stdout.trim();
    core.info(`Found subscription: ${subscription}`);

    return subscription.replace('/', '').replace('subscriptions', '');
}
