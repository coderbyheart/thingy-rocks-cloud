import {
	aws_events as Events,
	aws_events_targets as EventsTargets,
	aws_iam as IAM,
	aws_lambda as Lambda,
	Duration,
	Fn,
	Stack,
} from 'aws-cdk-lib'
import type { IPrincipal } from 'aws-cdk-lib/aws-iam/index.js'
import { Construct } from 'constructs'
import type { PackedLambda } from '../backend.js'
import { LambdaLogGroup } from '../resources/LambdaLogGroup.js'
import type { WebsocketAPI } from './WebsocketAPI.js'

/**
 * Publish the summary statistics for the devices
 */
export class PublishSummaries extends Construct {
	public constructor(
		parent: Stack,
		{
			lambdaSources,
			baseLayer,
			assetTrackerStackName,
			websocketAPI,
		}: {
			lambdaSources: {
				publishSummaries: PackedLambda
			}
			baseLayer: Lambda.ILayerVersion
			assetTrackerStackName: string
			websocketAPI: WebsocketAPI
		},
	) {
		super(parent, 'PublishSummaries')

		const lambda = new Lambda.Function(this, 'lambda', {
			handler: lambdaSources.publishSummaries.handler,
			architecture: Lambda.Architecture.ARM_64,
			runtime: Lambda.Runtime.NODEJS_18_X,
			timeout: Duration.seconds(15),
			memorySize: 1792,
			code: Lambda.Code.fromAsset(lambdaSources.publishSummaries.lambdaZipFile),
			description:
				'Publish the summary statistics for the devices, invoked every minute',
			layers: [baseLayer],
			environment: {
				VERSION: this.node.tryGetContext('version'),
				CONNECTIONS_TABLE_NAME: websocketAPI.connectionsTable.tableName,
				WEBSOCKET_MANAGEMENT_API_URL: websocketAPI.websocketManagementAPIURL,
				HISTORICALDATA_TABLE_INFO: Fn.importValue(
					`${assetTrackerStackName}:historicaldataTableInfo`,
				),
			},
			initialPolicy: [
				new IAM.PolicyStatement({
					actions: ['execute-api:ManageConnections'],
					resources: [websocketAPI.websocketAPIArn],
				}),
				new IAM.PolicyStatement({
					resources: [
						Fn.importValue(`${assetTrackerStackName}:historicaldataTableArn`),
					],
					actions: [
						'timestream:Select',
						'timestream:DescribeTable',
						'timestream:ListMeasures',
					],
				}),
				new IAM.PolicyStatement({
					resources: ['*'],
					actions: [
						'timestream:DescribeEndpoints',
						'timestream:SelectValues',
						'timestream:CancelQuery',
					],
				}),
			],
		})

		new LambdaLogGroup(this, 'Logs', lambda)

		websocketAPI.connectionsTable.grantWriteData(lambda)

		const rule = new Events.Rule(this, 'Rule', {
			schedule: Events.Schedule.expression('rate(1 minute)'),
			description: `Invoke the summary lambda`,
			enabled: true,
			targets: [new EventsTargets.LambdaFunction(lambda)],
		})

		lambda.addPermission('InvokeByEvents', {
			principal: new IAM.ServicePrincipal('events.amazonaws.com') as IPrincipal,
			sourceArn: rule.ruleArn,
		})
	}
}