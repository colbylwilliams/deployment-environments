import * as core from '@actions/core';
import * as exec from '@actions/exec';
import * as github from '@actions/github';
import * as glob from '@actions/glob';
import * as io from '@actions/io';
import * as fs from 'fs/promises';
import * as yaml from 'js-yaml';
import { Configuration, ConfigurationFile, Environment, EnvironmentConfig } from './types';

const AUTO = 'auto';
const SETUP = 'setup';
const GET = 'get';
const CREATE = 'create';
const UPDATE = 'update';
const ENSURE = 'ensure';
const DELETE = 'delete';
const ACTIONS = [SETUP, GET, CREATE, UPDATE, ENSURE, DELETE];

const PROD = 'Prod';
const STAGING = 'Staging';
const TEST = 'Test';
const DEV = 'Dev';

const MAIN_BRANCH = 'main';

const PREFIX = 'ci';

const DEFAULT_CONFIG_FILE = 'ade.yml';

const PREVIEW_DEVCENTER_EXTENSION = 'https://aka.ms/devcenter/cli/devcenter-0.2.0-py3-none-any.whl';

export async function run(): Promise<void> {
    const envCmd = ['devcenter', 'dev', 'environment'];

    try {
        const az = await io.which('az', true);
        core.debug(`az cli path: ${az}`);

        const config = await getConfiguration(az);

        if (config.action === SETUP) {
            core.info('Setting outputs:');
            core.info(`  name: ${config.environmentName}`);
            core.setOutput('name', config.environmentName);
            core.info(`  type: ${config.environmentType}`);
            core.setOutput('type', config.environmentType);

            core.info('Setting environment variables:');
            core.info(`  ADE_NAME: ${config.environmentName}`);
            core.exportVariable('ADE_NAME', config.environmentName);
            core.info(`  ADE_TYPE: ${config.environmentType}`);
            core.exportVariable('ADE_TYPE', config.environmentType);

            return;
        }

        core.info('Installing Azure CLI DevCenter extension');

        if (config.devCenterExtension) {
            core.warning(
                `Using user-provided devcenter extension. This may cause unexpected behavior. (${config.devCenterExtension})`
            );
            await exec.exec(az, ['extension', 'add', '--yes', '--source', config.devCenterExtension]);
        } else {
            await exec.exec(az, ['extension', 'add', '--yes', '--source', PREVIEW_DEVCENTER_EXTENSION]);
            // await exec.exec(az, ['extension', 'add', '--name', 'devcenter', '--upgrade']);
        }

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
            '--environment-definition-name',
            config.definition
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

            if (config.action === UPDATE) {
                core.info(`Action is ${config.action}, attempting to ${config.action} environment`);
                const update = await exec.getExecOutput(az, [...envCmd, UPDATE, ...envArgs, ...mutateArgs], {
                    ignoreReturnCode: true
                });
                if (update.exitCode === 0) {
                    core.info('Updated environment');
                    environment = JSON.parse(update.stdout) as Environment;
                } else {
                    throw Error(`Failed to ${config.action} environment: ${update.stderr}`);
                }
            } else if (config.action === DELETE) {
                core.info(`Action is ${config.action}, attempting to ${config.action} environment`);
                const del = await exec.getExecOutput(az, [...envCmd, DELETE, ...envArgs, '--yes'], {
                    ignoreReturnCode: true
                });
                if (del.exitCode === 0) {
                    core.info('Deleted environment');
                    // environment = undefined;
                } else {
                    throw Error(`Failed to ${config.action} environment: ${del.stderr}`);
                }
            }
        } else if (config.action === CREATE || config.action === ENSURE) {
            core.info(`No existing environment found`);
            core.info(`Action is ${config.action}, attempting to ${config.action} environment`);

            const create = await exec.getExecOutput(az, [...envCmd, CREATE, ...envArgs, ...mutateArgs], {
                ignoreReturnCode: true
            });

            exists = created = create.exitCode === 0;

            if (created) {
                core.info('Created environment');
                environment = JSON.parse(create.stdout) as Environment;
            } else {
                throw Error(`Failed to ${config.action} environment: ${create.stderr}`);
            }
        } else {
            core.info(`No existing environment found: code: ${show.exitCode}`);
        }

        setOutputsAndVariables(config, environment, exists, created);

        if (config.summary) {
            writeSummary(config);
        }
    } catch (error) {
        if (error instanceof Error) core.setFailed(error.message);
    }
}

async function getConfiguration(az: string): Promise<Configuration> {
    const config: Configuration = {} as Configuration;

    const action = (core.getInput('action', { required: false }) || SETUP).toLowerCase();
    config.action = action === AUTO ? getAutoAction() : action;

    if (!ACTIONS.includes(config.action))
        throw Error(`Invalid action: ${config.action}. Must be one of: ${ACTIONS.join(', ')}`);

    const file = await getConfigurationFile();

    config.prefix = core.getInput('prefix', { required: false }) || file?.prefix || PREFIX;
    config.suffix =
        core.getInput('suffix', { required: false }) || file?.suffix || process.env['GITHUB_REPOSITORY_ID']!;

    config.devBranch = core.getInput('dev-branch', { required: false }) || file?.['dev-branch'] || '';
    config.mainBranch = core.getInput('main-branch', { required: false }) || file?.['main-branch'] || MAIN_BRANCH;

    config.prodEnvironmentName =
        core.getInput('prod-environment-name', { required: false }) || file?.['prod-environment-name'] || '';

    config.prodEnvironmentType =
        core.getInput('prod-environment-type', { required: false }) || file?.['prod-environment-type'] || PROD;

    config.stagingEnvironmentType =
        core.getInput('staging-environment-type', { required: false }) || file?.['staging-environment-type'] || STAGING;

    config.testEnvironmentType =
        core.getInput('test-environment-type', { required: false }) || file?.['test-environment-type'] || TEST;

    config.devEnvironmentType =
        core.getInput('dev-environment-type', { required: false }) || file?.['dev-environment-type'] || DEV;

    config.devCenterExtension =
        core.getInput('devcenter-extension', { required: false }) || file?.['devcenter-extension'] || '';

    config.summary = core.getBooleanInput('summary', { required: false }) || file?.summary || false;

    const setup = getEnvironmentConfig(config);

    config.environmentName = setup.name;
    config.environmentType = setup.type;

    config.devcenter = core.getInput('devcenter', { required: false }) || file?.devcenter || '';
    config.project = core.getInput('project', { required: false }) || file?.project || '';
    config.catalog = core.getInput('catalog', { required: false }) || file?.catalog || '';
    config.definition = core.getInput('definition', { required: false }) || file?.['definition'] || '';
    config.parameters = core.getInput('parameters', { required: false }) || file?.parameters || '';

    config.tenant = core.getInput('tenant', { required: false }) || file?.tenant || '';
    config.subscription = core.getInput('subscription', { required: false }) || file?.subscription || '';

    if (config.action !== SETUP) {
        if (!config.tenant) config.tenant = await getTenant(az, config);
        if (!config.subscription) config.subscription = await getSubscription(az, config);

        if (!config.devcenter) throw Error('Must provide a value for devcenter as action input or in config file.');
        if (!config.project) throw Error('Must provide a value for project as action input or in config file.');

        if (config.action === CREATE || config.action === UPDATE || config.action === ENSURE) {
            if (!config.catalog) throw Error('Must provide a value for catalog as action input or in config file.');
            if (!config.definition)
                throw Error('Must provide a value for definition as action input or in config file.');
        }
    }

    core.info('Configuration:');
    core.info(`${JSON.stringify(config, null, 2)}`);

    return config;
}

async function getConfigurationFile(): Promise<ConfigurationFile | undefined> {
    const pattern = core.getInput('config', { required: false }) || DEFAULT_CONFIG_FILE;

    const isDefault = pattern === DEFAULT_CONFIG_FILE;
    const defaultText = isDefault ? ' (default)' : '';
    core.info(`Found input config: ${pattern}${defaultText}`);

    const globber = await glob.create(pattern);
    const files = await globber.glob();

    const file = files.length > 0 ? files[0] : undefined;

    if (!file) {
        core.info('No configuration file found, skipping');
        if (!isDefault) core.warning(`Could not find configuration file at path: ${pattern}`);
        return undefined;
    }

    core.info(`Found configuration file: ${file}`);

    const contents = await fs.readFile(file, 'utf8');
    core.info(contents);

    const config = yaml.load(contents) as ConfigurationFile;

    return config;
}

function getEnvironmentConfig(config: Configuration): EnvironmentConfig {
    const context = github.context;

    core.info(`${JSON.stringify(context, null, 2)}`);

    const { eventName } = context;

    core.info('Getting environment config:');
    core.info(`Event name: ${eventName}`);
    core.info(`Ref: ${context.ref}`);

    if (eventName != 'push' && eventName != 'pull_request' && eventName != 'create' && eventName != 'delete')
        throw new Error(`Unsupported event type: ${eventName}`);

    const isPr: boolean = eventName == 'pull_request';
    core.info(`Is PR: ${isPr}`);

    const refType: string = isPr ? 'pr' : 'branch';
    core.info(`Ref type: ${refType}`);

    const refName: string = isPr
        ? context.payload.pull_request!.number.toString() // PR number
        : context.payload.ref.replace('refs/heads/', ''); // Branch name
    core.info(`Ref name: ${refName}`);

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

    if (config.prodEnvironmentName && setup.type == config.prodEnvironmentType) {
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

function getAutoAction(): string {
    const context = github.context;

    const { eventName } = context;

    core.info('Input action set to auto, attempting to get it from the event type');

    if (eventName == 'pull_request') {
        const prAction = context.payload.action?.toLowerCase();
        if (!prAction) throw new Error(`Failed to get pull request action from context`);
        if (['opened', 'synchronize', 'reopened'].includes(prAction)) return 'ensure';
        if (prAction == 'closed') return 'delete';
        throw new Error(`Unsupported pull request action: ${prAction}`);
    }

    if (eventName == 'create' || eventName == 'delete') {
        const refType = context.payload.ref_type?.toLowerCase();
        if (!refType) throw new Error(`Failed to get ref type from context`);
        if (refType == 'branch') return eventName;
        throw new Error(`Unsupported ref type: ${refType}`);
    }

    if (eventName == 'push') {
        return 'ensure';
    }

    throw new Error(`Unsupported event type: ${eventName}`);
}

function setOutputsAndVariables(
    config: Configuration,
    environment: Environment | undefined,
    exists: boolean,
    created: boolean
): void {
    core.info('Setting outputs:');

    core.info(`  name: ${config.environmentName}`);
    core.setOutput('name', config.environmentName);

    core.info(`  type: ${config.environmentType}`);
    core.setOutput('type', config.environmentType);

    core.info(`  tenant: ${config.tenant}`);
    core.setOutput('tenant', config.tenant);

    let groupId = '';
    let group = '';
    let subscription = '';
    let portalUrl = '';

    if (environment) {
        groupId = environment.resourceGroupId;

        const resourceGroupKey = groupId.includes('/resourceGroups/') ? '/resourceGroups/' : '/resourcegroups/';

        group = groupId.split(resourceGroupKey)[1].split('/')[0];
        subscription = groupId.split('/subscriptions/')[1].split('/')[0];
        portalUrl = `https://portal.azure.com/#@${config.tenant}/resource${groupId}`;

        core.info(`  subscription: ${subscription}`);
        core.setOutput('subscription', subscription);

        core.info(`  resource-group: ${group}`);
        core.setOutput('resource-group', group);

        core.info(`  resource-group-id: ${groupId}`);
        core.setOutput('resource-group-id', groupId);

        core.info(`  portal-url: ${portalUrl}`);
        core.setOutput('portal-url', portalUrl);
    }

    core.info(`  exists: ${exists}`);
    core.setOutput('exists', exists);

    core.info(`  created: ${created}`);
    core.setOutput('created', created);

    core.info('Setting environment variables:');

    core.info(`  ADE_NAME: ${config.environmentName}`);
    core.exportVariable('ADE_NAME', config.environmentName);

    core.info(`  ADE_TYPE: ${config.environmentType}`);
    core.exportVariable('ADE_TYPE', config.environmentType);

    core.info(`  ADE_TENANT: ${config.tenant}`);
    core.exportVariable('ADE_TENANT', config.tenant);

    if (environment) {
        core.info(`  ADE_SUBSCRIPTION: ${subscription}`);
        core.exportVariable('ADE_SUBSCRIPTION', subscription);

        core.info(`  ADE_RESOURCE_GROUP: ${group}`);
        core.exportVariable('ADE_RESOURCE_GROUP', group);

        core.info(`  ADE_RESOURCE_GROUP_ID: ${groupId}`);
        core.exportVariable('ADE_RESOURCE_GROUP_ID', groupId);

        core.info(`  ADE_PORTAL_URL: ${portalUrl}`);
        core.exportVariable('ADE_PORTAL_URL', portalUrl);
    }

    core.info(`  ADE_EXISTS: ${exists}`);
    core.exportVariable('ADE_EXISTS', exists.toString());

    core.info(`  ADE_CREATED: ${created}`);
    core.exportVariable('ADE_CREATED', created.toString());
}

function writeSummary(config: Configuration): void {
    core.info('Writing summary:');
    core.summary.addHeading('Azure Deployment Environment', 2);
    core.summary.addList([
        `<b>Environment Tenant:</b> ${config.tenant}`,
        `<b>Environment DevCenter:</b> ${config.devcenter}`,
        `<b>Environment Project:</b> ${config.project}`,
        `<b>Environment Name:</b> ${config.environmentName}`,
        `<b>Environment Type:</b> ${config.environmentType}`
    ]);
    core.summary.write();
}
