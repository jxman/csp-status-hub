export const AWS_SERVICE_NAMES: Record<string, string> = {
  ec2: 'EC2',
  console: 'AWS Console',
  eks: 'EKS',
  cloudwatch: 'CloudWatch',
  s3: 'S3',
  rds: 'RDS',
  lambda: 'Lambda',
  iam: 'IAM',
  vpc: 'VPC',
  route53: 'Route 53',
  elasticloadbalancing: 'Elastic Load Balancing',
  cloudfront: 'CloudFront',
  dynamodb: 'DynamoDB',
  sqs: 'SQS',
  sns: 'SNS',
  elasticache: 'ElastiCache',
  ecs: 'ECS',
  codedeploy: 'CodeDeploy',
  codecommit: 'CodeCommit',
  codebuild: 'CodeBuild',
  codepipeline: 'CodePipeline',
  secretsmanager: 'Secrets Manager',
  kms: 'KMS',
  apigateway: 'API Gateway',
  glue: 'Glue',
  athena: 'Athena',
  redshift: 'Redshift',
  emr: 'EMR',
  kinesis: 'Kinesis',
  stepfunctions: 'Step Functions',
  sagemaker: 'SageMaker',
  bedrock: 'Bedrock',
  multipleservices: 'Multiple Services',
};

// Always shown in the region drill-down, in this order
export const AWS_CRITICAL_SERVICE_IDS = [
  'ec2',
  'console',
  'eks',
  'cloudwatch',
  's3',
  'rds',
  'lambda',
  'iam',
  'vpc',
  'route53',
];

export interface AwsServiceRssConfig {
  slug: string;
  global: boolean; // true = fetch {slug}.rss once; false = fetch {slug}-{region}.rss per region
}

// Maps our canonical service IDs to their RSS feed config.
// IAM and Route 53 are global services — no per-region RSS feed exists.
export const AWS_SERVICE_RSS_SLUGS: Record<string, AwsServiceRssConfig> = {
  ec2:        { slug: 'ec2',                global: false },
  console:    { slug: 'management-console', global: false },
  eks:        { slug: 'eks',                global: false },
  cloudwatch: { slug: 'cloudwatch',         global: false },
  s3:         { slug: 's3',                 global: false },
  rds:        { slug: 'rds',                global: false },
  lambda:     { slug: 'lambda',             global: false },
  iam:        { slug: 'iam',                global: true  },
  vpc:        { slug: 'vpc',                global: false },
  route53:    { slug: 'route53',            global: true  },
};
